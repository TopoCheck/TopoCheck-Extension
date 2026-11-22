import type { Device, PortMode, ProtocolSettings } from "../modules/topology/models";
import { Ipv4AclConfiguration, Ipv4AclRule, MAX_IPV4_ACLS, MAX_IPV4_ACL_RULES } from "../models/ciscoProtocols";
import { MAX_STATIC_NAT_MAPPINGS, PatConfiguration, StaticNatConfiguration, StaticNatMapping } from "../models/ciscoProtocols";
import { DeviceType } from "../models/deviceType";
import { ProtocolType } from "../models/protocolType";
import { compatibleProtocols, configurationOf, DeviceConfiguration } from "../shared/deviceConfiguration";
import { ConfigurationFieldError, validateDeviceConfiguration } from "../shared/validateDeviceConfiguration";
import type { ExtensionToWebviewMessage } from "../shared/protocol";
import { DEVICE_TYPE_LABEL, iconHref } from "./icons";
import { svgElement } from "./svg";
import { vscodeApi } from "./vscodeApi";
import { defaultSettings, isProtocolComplete } from "../shared/switchingSettings";

const MIN_WIDTH = 280;
/** Diese Protokolle haben eigene Formulare (Routing, DHCP); alle anderen nutzen die aufklappbare Protokollzeile. */
const FORM_PROTOCOLS: readonly ProtocolType[] = [
    ProtocolType.Rip, ProtocolType.Ospf, ProtocolType.Dhcp, ProtocolType.StaticRoute,
    ProtocolType.Acl, ProtocolType.Nat, ProtocolType.Pat
];

export interface FormWidthStore { initialWidth?: number; saveWidth(width: number): void }

/** Ein Protokolleintrag im Formular; read() liefert die aktuellen Eingaben. */
interface ProtocolControl {
    type: ProtocolType;
    selected: HTMLInputElement;
    read(): ProtocolSettings | undefined;
}

type FieldControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type FormControl = FieldControl | HTMLButtonElement;

const PROTOCOL_GROUP_LABELS = {
    routing: "Routing",
    switching: "Switching",
    services: "Netzwerkdienste",
    security: "Sicherheit und Adressübersetzung"
};

const PROTOCOL_DISPLAY: Record<ProtocolType, { label: string; group: keyof typeof PROTOCOL_GROUP_LABELS }> = {
    [ProtocolType.Rip]: { label: "RIP", group: "routing" },
    [ProtocolType.Ospf]: { label: "OSPF", group: "routing" },
    [ProtocolType.StaticRoute]: { label: "Statische Routen", group: "routing" },
    [ProtocolType.Vlan]: { label: "VLAN", group: "switching" },
    [ProtocolType.Stp]: { label: "STP", group: "switching" },
    [ProtocolType.Rstp]: { label: "RSTP", group: "switching" },
    [ProtocolType.EtherChannel]: { label: "EtherChannel", group: "switching" },
    [ProtocolType.Dhcp]: { label: "DHCP", group: "services" },
    [ProtocolType.Acl]: { label: "IPv4-ACL", group: "security" },
    [ProtocolType.Nat]: { label: "Statisches NAT", group: "security" },
    [ProtocolType.Pat]: { label: "PAT", group: "security" }
};

/** Non-modal inspector: edits are drafts until the extension confirms saving. */
export class DeviceConfigurationForm {
    private readonly dialog = document.createElement("dialog");
    private pending = false;
    private dirty = false;
    private deviceId: string | undefined;
    private error: HTMLElement | undefined;
    private submit: HTMLButtonElement | undefined;
    private switchNotice: HTMLElement | undefined;
    private readonly disabledBeforeSave = new Map<FormControl, boolean>();
    private readonly fields = new Map<string, { control: FieldControl; error: HTMLElement }>();
    private readonly interfaceCards = new Map<string, { card: HTMLElement; status: HTMLElement; enabled: HTMLInputElement; edited: boolean }>();
    private connectedIds = new Set<string>();
    private showAllInterfaces: HTMLInputElement | undefined;
    private emptyInterfaces: HTMLElement | undefined;
    private interfaceFilterInfo: HTMLElement | undefined;
    private protocolTypes: ProtocolType[] = [];
    private readonly resizer = document.createElement("div");

    constructor(private readonly root: HTMLElement, private readonly widthStore?: FormWidthStore) {
        this.dialog.className = "device-configuration";
        this.dialog.setAttribute("aria-labelledby", "device-configuration-title");
        this.dialog.setAttribute("aria-modal", "false");
        this.dialog.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") { event.preventDefault(); this.requestClose(); }
        });
        this.dialog.addEventListener("close", () => {
            this.root.classList.remove("configuration-open");
        });
        (root.querySelector(".workspace") ?? root).append(this.dialog);
        this.setupResizer();
    }

    /** Linker Rand ist ziehbar; die Breite bleibt pro Topologieansicht gespeichert. */
    private setupResizer(): void {
        this.resizer.className = "configuration-resizer";
        this.resizer.setAttribute("role", "separator");
        this.resizer.setAttribute("aria-orientation", "vertical");
        this.resizer.setAttribute("aria-label", "Formularbreite ändern");
        if (this.widthStore?.initialWidth) { this.applyWidth(this.widthStore.initialWidth); }
        this.resizer.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            this.resizer.setPointerCapture(event.pointerId);
            const right = this.dialog.getBoundingClientRect().right;
            const move = (moveEvent: PointerEvent) => this.applyWidth(right - moveEvent.clientX);
            const stop = () => {
                this.resizer.removeEventListener("pointermove", move);
                this.widthStore?.saveWidth(this.dialog.getBoundingClientRect().width);
            };
            this.resizer.addEventListener("pointermove", move);
            this.resizer.addEventListener("pointerup", stop, { once: true });
        });
    }

    private applyWidth(width: number): void {
        // Mindestens 200 px Zeichenfläche bleiben sichtbar.
        const max = Math.max(MIN_WIDTH, this.root.clientWidth - 200);
        const clamped = Math.round(Math.min(Math.max(width, MIN_WIDTH), max));
        this.dialog.style.setProperty("--configuration-width", `${clamped}px`);
    }

    receive(message: ExtensionToWebviewMessage): void {
        if (message.type === "editDevice") {
            if (this.pending || (this.dialog.open && message.device.id === this.deviceId)) { return; }
            if (this.dialog.open && this.dirty) {
                this.confirmDiscard(`Zu „${message.device.label}“ wechseln und ungespeicherte Änderungen verwerfen?`,
                    () => this.open(message.device, message.otherHostnames, message.connectedInterfaceIds ?? []));
            } else { this.open(message.device, message.otherHostnames, message.connectedInterfaceIds ?? []); }
        } else if (message.type === "state" && this.dialog.open) {
            if (!this.pending && !message.topology.devices.some((device) => device.id === this.deviceId)) {
                this.close();
            } else {
                const previouslyConnected = this.connectedIds;
                this.connectedIds = new Set(message.topology.connections.flatMap((connection) =>
                    [connection.interfaceAId, connection.interfaceBId]));
                const device = message.topology.devices.find((item) => item.id === this.deviceId);
                for (const iface of device?.interfaces ?? []) {
                    const entry = this.interfaceCards.get(iface.id);
                    if (entry && (!entry.edited || previouslyConnected.has(iface.id) !== this.connectedIds.has(iface.id))) {
                        entry.enabled.checked = iface.enabled ?? this.connectedIds.has(iface.id);
                        entry.edited = false;
                    }
                }
                this.updateInterfaceVisibility();
            }
        } else if (message.type === "configurationResult" &&
            this.dialog.open && this.pending && message.deviceId === this.deviceId) {
            this.pending = false;
            for (const [control, disabled] of this.disabledBeforeSave) { control.disabled = disabled; }
            this.disabledBeforeSave.clear();
            if (this.submit) { this.submit.textContent = "Speichern"; }
            if (message.validationErrors?.length) { this.showValidationErrors(message.validationErrors); }
            else if (message.error) { this.showError(message.error); }
            else { this.close(); }
        }
    }

    private close(): void {
        this.dialog.close();
        this.root.classList.remove("configuration-open");
        this.dirty = false;
        // Do not restore focus to an input removed during a device switch.
        this.root.querySelector<HTMLElement>(".canvas")?.focus({ preventScroll: true });
    }

    private requestClose(): void {
        if (this.pending) { return; }
        if (this.dirty) { this.confirmDiscard("Ungespeicherte Änderungen verwerfen?", () => this.close()); }
        else { this.close(); }
    }

    private confirmDiscard(text: string, discard: () => void): void {
        this.showConfirmation(text, "Verwerfen", "Weiter bearbeiten", discard);
    }

    private showConfirmation(
        text: string,
        confirmLabel: string,
        cancelLabel: string,
        confirm: () => void,
        trigger?: HTMLButtonElement
    ): void {
        const notice = this.switchNotice;
        if (!notice) { return; }
        notice.replaceChildren();
        const message = document.createElement("p");
        message.textContent = text;
        const yes = button(confirmLabel);
        if (trigger) { yes.className = "configuration-delete-confirm"; }
        yes.addEventListener("click", () => {
            notice.hidden = true;
            confirm();
        });
        const no = button(cancelLabel);
        no.className = "configuration-secondary";
        no.addEventListener("click", () => {
            notice.hidden = true;
            trigger?.focus();
        });
        notice.append(message, yes, no);
        notice.hidden = false;
        notice.scrollIntoView({ block: "nearest" });
        if (trigger) { no.focus({ preventScroll: true }); }
    }

    private showError(message: string): void {
        if (this.error) { this.error.textContent = message; this.error.hidden = false; this.error.focus(); }
    }

    private clearValidationErrors(): void {
        for (const { control, error } of this.fields.values()) {
            control.removeAttribute("aria-invalid"); error.textContent = ""; error.hidden = true;
        }
        if (this.error) { this.error.hidden = true; }
    }

    private showValidationErrors(errors: ConfigurationFieldError[]): void {
        this.clearValidationErrors();
        // Server-Pfade "protocols.<n>" beziehen sich auf die abgeschickte Liste, das Formular kennt Typen.
        errors = errors.map((issue) => this.fields.has(issue.field) ? issue : ({
            ...issue, field: issue.field.replace(/^protocols\.(\d+)/,
                (match, index: string) => this.protocolTypes[Number(index)] ? `protocol:${this.protocolTypes[Number(index)]}` : match)
        }));
        for (const issue of errors) {
            const field = this.fields.get(issue.field);
            if (field) {
                field.control.setAttribute("aria-invalid", "true");
                field.error.textContent += (field.error.textContent ? "\n" : "") + issue.message;
                field.error.hidden = false;
            }
        }
        this.showError(errors.map((issue) => issue.message).join("\n"));
        const first = errors.find((issue) => this.fields.has(issue.field));
        if (first) {
            const control = this.fields.get(first.field)!.control;
            for (let details = control.closest("details"); details; details = details.parentElement?.closest("details") ?? null) {
                details.open = true;
            }
            if (control.closest<HTMLElement>(".configuration-interface-card")?.hidden && this.showAllInterfaces) {
                this.showAllInterfaces.checked = true;
                this.updateInterfaceVisibility();
            }
            control.focus();
        }
    }

    private updateInterfaceVisibility(): void {
        let visible = 0;
        for (const [id, { card, status, enabled }] of this.interfaceCards) {
            const connected = this.connectedIds.has(id);
            const used = connected && enabled.checked;
            card.hidden = !this.showAllInterfaces?.checked && !used;
            status.textContent = connected ? (enabled.checked ? "Verbunden · In Nutzung" : "Verbunden · Deaktiviert") : "Frei";
            if (!card.hidden) { visible++; }
        }
        if (this.emptyInterfaces) {
            this.emptyInterfaces.hidden = visible > 0;
            this.emptyInterfaces.textContent = this.interfaceCards.size
                ? "Keine verbundenen Interfaces in Nutzung. Mit „Alle Interfaces anzeigen“ kannst du weitere Ports einblenden."
                : "Keine Interfaces vorhanden.";
        }
        if (this.interfaceFilterInfo) {
            this.interfaceFilterInfo.textContent = this.showAllInterfaces?.checked
                ? "Es werden alle Interfaces angezeigt, auch unverbundene oder deaktivierte."
                : "Aktuell werden nur Interfaces angezeigt, die verbunden und in Nutzung sind.";
        }
    }

    private validatedField(key: string, text: string, control: FieldControl): HTMLElement {
        const wrapper = document.createElement("div");
        wrapper.className = "configuration-field";
        const error = document.createElement("p");
        error.id = `configuration-field-error-${this.fields.size}`;
        error.className = "configuration-field-error";
        error.hidden = true;
        control.setAttribute("aria-describedby", error.id);
        this.fields.set(key, { control, error });
        wrapper.append(field(text, control), error);
        return wrapper;
    }

    private appendAclSettings(
        settings: HTMLElement,
        device: Device,
        saved: readonly Ipv4AclConfiguration[]
    ): () => Ipv4AclConfiguration[] {
        const cards = document.createElement("div");
        const readAcls = new Map<HTMLElement, () => Ipv4AclConfiguration>();
        const add = itemButton("ACL hinzufügen", "add");

        const addAcl = (acl?: Ipv4AclConfiguration) => {
            const card = document.createElement("section");
            card.className = "configuration-advanced";
            const title = document.createElement("h4");
            title.className = "configuration-acl-title";
            card.append(title);
            const remove = itemButton("ACL entfernen", "remove");
            remove.addEventListener("click", () => {
                const aclName = name.value.trim();
                const question = aclName
                    ? `Möchtest du die ACL „${aclName}“ mit allen Regeln wirklich entfernen?`
                    : "Möchtest du diese ACL mit allen Regeln wirklich entfernen?";
                this.showConfirmation(question, "ACL entfernen", "Abbrechen", () => {
                    readAcls.delete(card);
                    card.remove();
                    add.disabled = false;
                    this.dirty = true;
                    this.clearValidationErrors();
                    add.focus();
                }, remove);
            });
            const { name, read } = this.appendAclFields(card, device, acl);
            const updateTitle = () => { title.textContent = name.value.trim() || "Neue IPv4-ACL"; };
            readAcls.set(card, read);
            updateTitle();
            name.addEventListener("input", updateTitle);
            card.append(remove);
            cards.append(card);
            add.disabled = readAcls.size >= MAX_IPV4_ACLS;
            if (!acl) {
                name.focus();
            }
        };

        saved.forEach(addAcl);
        add.addEventListener("click", () => {
            if (readAcls.size >= MAX_IPV4_ACLS) { return; }
            this.dirty = true;
            this.clearValidationErrors();
            addAcl();
        });
        settings.append(cards, add);
        return () => Array.from(readAcls.values(), (read) => read());
    }

    private appendAclFields(
        settings: HTMLElement,
        device: Device,
        saved: Ipv4AclConfiguration | undefined
    ): { name: HTMLInputElement; read: () => Ipv4AclConfiguration } {
        const name = input("text", saved?.name ?? "", 64);
        const iface = layer3InterfaceSelect(device, "Ohne Interface-Zuweisung", saved?.binding?.interfaceId);

        const direction = document.createElement("select");
        direction.append(new Option("Eingehend (in)", "in"), new Option("Ausgehend (out)", "out"));
        direction.value = saved?.binding?.direction ?? "in";
        direction.disabled = !iface.value;
        iface.addEventListener("change", () => { direction.disabled = !iface.value; });

        const rules = document.createElement("div");
        const readRules = new Map<HTMLElement, () => Ipv4AclRule>();
        const add = itemButton("ACL-Regel hinzufügen", "add");

        const addRule = (rule?: Ipv4AclRule) => {
            const row = document.createElement("fieldset");
            row.className = "configuration-advanced";
            const legend = document.createElement("legend");
            legend.textContent = "IPv4-Regel";
            const action = document.createElement("select");
            action.append(new Option("Erlauben (permit)", "permit"), new Option("Verwerfen (deny)", "deny"));
            action.value = rule?.action ?? "permit";
            const source = input("text", rule?.source ?? "", 15);
            const sourceWildcard = input("text", rule?.sourceWildcard ?? "", 15);
            const destination = input("text", rule?.destination ?? "", 15);
            const destinationWildcard = input("text", rule?.destinationWildcard ?? "", 15);
            source.placeholder = destination.placeholder = "IPv4-Adresse oder any";
            sourceWildcard.placeholder = destinationWildcard.placeholder = "Leer für Einzeladresse oder any";
            const remove = itemButton("Regel entfernen", "remove");
            remove.addEventListener("click", () => {
                this.showConfirmation("Möchtest du diese ACL-Regel wirklich entfernen?", "Regel entfernen", "Abbrechen", () => {
                    readRules.delete(row);
                    row.remove();
                    add.disabled = false;
                    this.dirty = true;
                    this.clearValidationErrors();
                    add.focus();
                }, remove);
            });
            row.append(legend, field("Aktion", action), field("Quelle", source),
                field("Quell-Wildcard", sourceWildcard), field("Ziel", destination),
                field("Ziel-Wildcard", destinationWildcard), remove);
            readRules.set(row, () => ({
                action: action.value === "deny" ? "deny" : "permit",
                source: source.value.trim(),
                sourceWildcard: sourceWildcard.value.trim(),
                destination: destination.value.trim(),
                destinationWildcard: destinationWildcard.value.trim()
            }));
            rules.append(row);
            add.disabled = readRules.size >= MAX_IPV4_ACL_RULES;
            return source;
        };

        for (const rule of saved?.rules ?? []) {
            addRule(rule);
        }
        add.addEventListener("click", () => {
            if (readRules.size >= MAX_IPV4_ACL_RULES) { return; }
            this.dirty = true;
            this.clearValidationErrors();
            addRule().focus();
        });
        settings.append(field("ACL-Name", name), field("Interface (optional)", iface),
            field("Richtung", direction), rules, add);

        return {
            name,
            read: () => ({
                name: name.value.trim(),
                rules: Array.from(readRules.values(), (read) => read()),
                binding: iface.value ? {
                    interfaceId: iface.value,
                    direction: direction.value === "out" ? "out" : "in"
                } : undefined
            })
        };
    }

    private appendStaticNatSettings(
        settings: HTMLElement,
        device: Device,
        saved: StaticNatConfiguration | undefined,
        protocolIndex: number
    ): () => StaticNatConfiguration {
        const prefix = `protocols.${protocolIndex}.nat`;
        const inside = layer3InterfaceSelect(device, "Inside-Interface auswählen", saved?.insideInterfaceId);
        const outside = layer3InterfaceSelect(device, "Outside-Interface auswählen", saved?.outsideInterfaceId);
        const rows = document.createElement("div");
        const mappings = new Map<HTMLElement, () => StaticNatMapping>();
        const add = itemButton("NAT-Zuordnung hinzufügen", "add");

        const addMapping = (mapping?: StaticNatMapping) => {
            const row = document.createElement("fieldset");
            row.className = "configuration-advanced";
            const legend = document.createElement("legend");
            legend.textContent = "Statische NAT-Zuordnung";
            const local = input("text", mapping?.localAddress ?? "", 15);
            const global = input("text", mapping?.globalAddress ?? "", 15);
            const remove = itemButton("Zuordnung entfernen", "remove");
            remove.addEventListener("click", () => {
                this.showConfirmation("Möchtest du diese NAT-Zuordnung wirklich entfernen?", "Zuordnung entfernen", "Abbrechen", () => {
                    mappings.delete(row);
                    row.remove();
                    add.disabled = false;
                    this.dirty = true;
                    this.clearValidationErrors();
                    add.focus();
                }, remove);
            });
            row.append(legend, field("Interne IP (Inside Local)", local),
                field("Übersetzte IP (Inside Global)", global), remove);
            mappings.set(row, () => ({
                localAddress: local.value.trim(),
                globalAddress: global.value.trim()
            }));
            rows.append(row);
            add.disabled = mappings.size >= MAX_STATIC_NAT_MAPPINGS;
            return local;
        };

        saved?.mappings.forEach(addMapping);
        add.addEventListener("click", () => {
            if (mappings.size >= MAX_STATIC_NAT_MAPPINGS) { return; }
            this.dirty = true;
            this.clearValidationErrors();
            addMapping().focus();
        });
        settings.append(this.validatedField(`${prefix}.insideInterfaceId`, "Inside-Interface", inside),
            this.validatedField(`${prefix}.outsideInterfaceId`, "Outside-Interface", outside), rows, add);

        return () => ({
            insideInterfaceId: inside.value,
            outsideInterfaceId: outside.value,
            mappings: Array.from(mappings.values(), (read) => read())
        });
    }

    private appendPatSettings(
        settings: HTMLElement,
        enabled: HTMLInputElement,
        device: Device,
        saved: PatConfiguration | undefined,
        protocolIndex: number,
        readAcls: () => Ipv4AclConfiguration[],
        readNat: () => StaticNatConfiguration | undefined
    ): () => PatConfiguration {
        const prefix = `protocols.${protocolIndex}.pat`;
        const inside = layer3InterfaceSelect(device, "Inside-Interface auswählen", saved?.insideInterfaceId);
        const outside = layer3InterfaceSelect(device, "Outside-Interface auswählen", saved?.outsideInterfaceId);
        const acl = document.createElement("select");
        const refreshAclOptions = (selected: string) => {
            const names = new Set(readAcls().map(({ name }) => name).filter(Boolean));
            acl.replaceChildren(new Option("ACL auswählen", ""));
            for (const name of names) {
                acl.append(new Option(name, name));
            }
            if (selected && !names.has(selected)) {
                const unavailable = new Option(`${selected} (nicht verfügbar)`, selected);
                unavailable.disabled = true;
                acl.append(unavailable);
            }
            acl.value = selected;
        };
        refreshAclOptions(saved?.aclName ?? "");
        acl.addEventListener("focus", () => refreshAclOptions(acl.value));
        enabled.addEventListener("change", () => {
            if (!enabled.checked) { return; }
            refreshAclOptions(acl.value);
            const nat = readNat();
            if (nat) {
                inside.value ||= nat.insideInterfaceId;
                outside.value ||= nat.outsideInterfaceId;
            }
        });
        settings.append(this.validatedField(`${prefix}.aclName`, "ACL für zu übersetzenden Verkehr", acl),
            this.validatedField(`${prefix}.insideInterfaceId`, "Inside-Interface", inside),
            this.validatedField(`${prefix}.outsideInterfaceId`, "Outside-Interface für Overload", outside));

        return () => ({
            aclName: acl.value,
            insideInterfaceId: inside.value,
            outsideInterfaceId: outside.value
        });
    }

    private open(device: Device, otherHostnames: string[], connectedIds: string[]): void {
        this.deviceId = device.id; this.pending = false; this.dirty = false;
        this.fields.clear(); this.disabledBeforeSave.clear();
        this.interfaceCards.clear(); this.connectedIds = new Set(connectedIds);
        const draft = configurationOf(device, connectedIds);
        const form = document.createElement("form");
        form.noValidate = true;
        form.addEventListener("input", () => { this.dirty = true; });
        form.addEventListener("change", () => { this.dirty = true; });

        const header = document.createElement("header");
        header.className = `configuration-header configuration-${device.type}`;
        const icon = svgElement("svg", { viewBox: "0 0 64 64", "aria-hidden": "true", class: "configuration-device-icon" });
        icon.append(svgElement("use", { href: iconHref(device.type) }));
        const heading = document.createElement("div");
        const title = document.createElement("h2");
        title.id = "device-configuration-title"; title.textContent = device.label;
        const subtitle = document.createElement("span");
        subtitle.textContent = DEVICE_TYPE_LABEL[device.type];
        heading.append(title, subtitle);
        const close = button("×"); close.className = "configuration-close";
        close.setAttribute("aria-label", "Gerätekonfiguration schließen");
        close.addEventListener("click", () => this.requestClose());
        header.append(icon, heading, close);
        form.append(header);

        const content = document.createElement("div");
        content.className = "configuration-content";
        this.switchNotice = document.createElement("div");
        this.switchNotice.className = "configuration-switch-notice";
        this.switchNotice.setAttribute("role", "alert"); this.switchNotice.hidden = true;
        this.error = document.createElement("p");
        this.error.className = "configuration-error"; this.error.setAttribute("role", "alert");
        this.error.tabIndex = -1; this.error.hidden = true;
        const note = document.createElement("p");
        note.className = "configuration-note"; note.textContent = "* Pflichtfeld · Weitere Angaben optional";
        content.append(this.switchNotice, this.error, note);

        const label = input("text", draft.label ?? device.hostname, 128);
        label.required = true;
        const hostname = input("text", draft.hostname, 63); hostname.required = true;
        const domain = input("text", draft.domainName ?? "", 253); domain.placeholder = "z. B. schule.at";
        const username = input("text", draft.username ?? "", 64);
        const enableSecret = input("password", draft.enableSecret ?? "", 128);
        const consolePassword = input("password", draft.consolePassword ?? "", 128);
        const vtyPassword = input("password", draft.vtyPassword ?? "", 128);
        const banner = document.createElement("textarea");
        banner.value = draft.banner ?? ""; banner.rows = 3; banner.maxLength = 4096;
        banner.placeholder = "z. B. Authorized Access Only";
        content.append(this.validatedField("label", "Name / Label *", label),
            this.validatedField("hostname", "Hostname *", hostname),
            this.validatedField("domainName", "Domain-Name", domain),
            this.validatedField("username", "Benutzername", username),
            this.validatedField("enableSecret", "Enable Secret", enableSecret),
            this.validatedField("consolePassword", "Console-Passwort", consolePassword),
            this.validatedField("vtyPassword", "VTY-Passwort", vtyPassword),
            this.validatedField("banner", "Banner", banner));

        const interfaces = section("Interfaces");
        this.showAllInterfaces = input("checkbox");
        this.showAllInterfaces.addEventListener("change", (event) => {
            // This is a view preference, not a configuration edit.
            event.stopPropagation();
            this.updateInterfaceVisibility();
        });
        this.showAllInterfaces.addEventListener("input", (event) => event.stopPropagation());
        const filter = field("Alle Interfaces anzeigen", this.showAllInterfaces);
        filter.classList.add("configuration-interface-filter");
        interfaces.append(filter);
        this.interfaceFilterInfo = document.createElement("p");
        this.interfaceFilterInfo.id = "interface-filter-info";
        this.interfaceFilterInfo.className = "configuration-note";
        this.showAllInterfaces.setAttribute("aria-describedby", this.interfaceFilterInfo.id);
        interfaces.append(this.interfaceFilterInfo);
        const isSwitch = device.type === DeviceType.Switch;
        let vlanList: () => { id: number; name: string }[] = () => [];
        let vlanSelected = () => false;
        const switchPorts: { mode: HTMLSelectElement; vlan: HTMLSelectElement; wrapper: HTMLElement }[] = [];
        const refreshSwitchPorts = () => {
            for (const { mode, vlan, wrapper } of switchPorts) {
                wrapper.hidden = !vlanSelected();
                fillVlanSelect(vlan, vlanList());
                vlan.disabled = mode.value === "trunk";
            }
        };
        const controls = device.interfaces.map((iface, index) => {
            const card = document.createElement("section"); card.className = "configuration-interface-card";
            const cardHeader = document.createElement("header"); cardHeader.className = "configuration-interface-header";
            const name = document.createElement("h3"); name.textContent = iface.name;
            cardHeader.append(name);
            const status = document.createElement("span"); status.className = "configuration-port-status";
            status.textContent = connectedIds.includes(iface.id) ? "Verbunden" : "Frei";
            const enabled = input("checkbox"); enabled.checked = draft.interfaces[index].enabled;
            enabled.setAttribute("aria-label", `${iface.name}: Aktiviert`);
            enabled.addEventListener("change", () => {
                const entry = this.interfaceCards.get(iface.id);
                if (entry) { entry.edited = true; }
                this.updateInterfaceVisibility();
            });
            const ip = input("text", draft.interfaces[index].ipAddress, 32); ip.placeholder = "192.168.10.10";
            ip.setAttribute("aria-label", `${iface.name}: IPv4-Adresse`);
            const mask = input("text", draft.interfaces[index].subnetMask, 32); mask.placeholder = "255.255.255.0";
            mask.setAttribute("aria-label", `${iface.name}: Subnetzmaske`);
            const description = input("text", draft.interfaces[index].description ?? "", 240);
            description.placeholder = "Beschreibung (optional)";
            description.setAttribute("aria-label", `${iface.name}: Beschreibung`);
            card.append(cardHeader, status,
                this.validatedField(`interfaces.${index}.ipAddress`, "IPv4-Adresse", ip),
                this.validatedField(`interfaces.${index}.subnetMask`, "Subnetzmaske", mask),
                this.validatedField(`interfaces.${index}.description`, "Beschreibung", description),
                field("Aktiviert", enabled));
            let switchport: { mode: HTMLSelectElement; vlan: HTMLSelectElement } | undefined;
            if (isSwitch) {
                const mode = select([["auto", "Automatisch (nach Gegenstelle)"], ["access", "Access"], ["trunk", "Trunk"]],
                    draft.interfaces[index].portMode ?? "auto");
                const vlan = document.createElement("select");
                vlan.dataset.value = String(draft.interfaces[index].accessVlan ?? "");
                mode.addEventListener("change", refreshSwitchPorts);
                const wrapper = document.createElement("div"); wrapper.className = "configuration-switchport";
                wrapper.append(this.validatedField(`interfaces.${index}.portMode`, "Port-Modus", mode),
                    this.validatedField(`interfaces.${index}.accessVlan`, "Access-VLAN", vlan));
                card.append(wrapper);
                switchPorts.push({ mode, vlan, wrapper });
                switchport = { mode, vlan };
            }
            interfaces.append(card);
            this.interfaceCards.set(iface.id, { card, status, enabled, edited: false });
            return { id: iface.id, enabled, ip, mask, description, switchport };
        });
        this.emptyInterfaces = document.createElement("p");
        this.emptyInterfaces.className = "configuration-note";
        interfaces.append(this.emptyInterfaces);
        this.updateInterfaceVisibility();
        content.append(interfaces);


        const protocols = section("Protokolle");
        const protocolGroups = new Map<keyof typeof PROTOCOL_GROUP_LABELS, HTMLDivElement>();
        const protocolCards = (group: keyof typeof PROTOCOL_GROUP_LABELS): HTMLDivElement => {
            const existing = protocolGroups.get(group);
            if (existing) { return existing; }
            const category = document.createElement("details");
            category.className = "configuration-protocol-group";
            category.dataset.group = group;
            category.open = true;
            const summary = document.createElement("summary");
            summary.textContent = PROTOCOL_GROUP_LABELS[group];
            const cards = document.createElement("div");
            cards.className = "configuration-protocol-list";
            category.append(summary, cards);
            protocols.append(category);
            protocolGroups.set(group, cards);
            return cards;
        };
        const deviceProtocols: readonly ProtocolType[] = compatibleProtocols[device.type as DeviceType];
        // H3b: VLAN, STP, RSTP, EtherChannel als Zeile "☐ Name … Aktiviert" mit aufklappbarem Formular
        const protocolControls: ProtocolControl[] = deviceProtocols.filter((type) => !FORM_PROTOCOLS.includes(type)).map((type: ProtocolType) => {
            const saved = draft.protocols.find((item) => item.type === type);
            const settings = saved?.settings ?? defaultSettings(type);
            const item = this.protocolItem(type, saved !== undefined, settings);
            protocolCards(PROTOCOL_DISPLAY[type].group).append(item.element);
            return item.control;
        });
        const vlanControl = protocolControls.find((item) => item.type === ProtocolType.Vlan);
        if (vlanControl) {
            vlanList = () => vlanControl.read()?.vlans ?? [];
            vlanSelected = () => vlanControl.selected.checked;
            protocols.addEventListener("input", refreshSwitchPorts);
            protocols.addEventListener("change", refreshSwitchPorts);
        }
        // Ein Switch läuft immer nur in einem STP-Modus.
        const stp = protocolControls.find((item) => item.type === ProtocolType.Stp);
        const rstp = protocolControls.find((item) => item.type === ProtocolType.Rstp);
        if (stp && rstp) {
            stp.selected.addEventListener("change", () => { if (stp.selected.checked) { setChecked(rstp.selected, false); } });
            rstp.selected.addEventListener("change", () => { if (rstp.selected.checked) { setChecked(stp.selected, false); } });
        }
        refreshSwitchPorts();

        // Protokolle mit eigenen Formularen (RIP, OSPF, DHCP, statische Routen)
        const routingControls = deviceProtocols.filter((type) => FORM_PROTOCOLS.includes(type)).map((type, protocolIndex) => {
            const saved = draft.protocols.find((item) => item.type === type);
            const savedProcesses = saved?.ospf?.processes ?? [];
            const { card, enabled, settings } = protocolCard(type, saved?.enabled ?? false);
            protocolCards(PROTOCOL_DISPLAY[type].group).append(card);

            const ripNetworkControls: HTMLInputElement[] = [];

            const dhcpPoolControls: {
                name: HTMLInputElement;
                interfaceName: HTMLSelectElement;
                dnsServer: HTMLInputElement;
                excludedAddresses: HTMLInputElement;
            }[] = [];
            let ripVersion: HTMLSelectElement | undefined;
            let ripNoAutoSummary: HTMLInputElement | undefined;

            const ospfNetworkControls: {
                address: HTMLInputElement;
                wildcardMask: HTMLInputElement;
                area: HTMLInputElement;
            }[] = [];

            const staticRouteControls: {
                destination: HTMLInputElement;
                subnetMask: HTMLInputElement;
                nextHop: HTMLInputElement;
                outgoingInterface: HTMLSelectElement;
                administrativeDistance: HTMLInputElement;
            }[] = [];

            const passiveInterfaceControls = new Map<string, HTMLInputElement>();


            if (type === ProtocolType.Dhcp) {
                const heading = document.createElement("h4");
                heading.textContent = "DHCP-Einstellungen";
                settings.append(heading);

                const poolList = document.createElement("div");
                poolList.className = "configuration-network-list";

                const savedPools = saved?.dhcp?.pools ?? [];

                const updatePoolHeadings = () => {
                    poolList.querySelectorAll("h4").forEach((item, index) => {
                        item.textContent = `DHCP-Pool ${index + 1}`;
                    });
                };

                const addPool = (pool?: {
                    name: string;
                    interfaceName: string;
                    dnsServer?: string;
                    excludedAddresses?: string[];
                }) => {
                    const poolSection = document.createElement("section");
                    poolSection.className = "configuration-dhcp-pool";

                    const poolHeading = document.createElement("h4");
                    poolHeading.textContent = `DHCP-Pool ${dhcpPoolControls.length + 1}`;

                    const name = input("text", pool?.name ?? "", 64);
                    name.placeholder = "z. B. LAN_POOL";

                    const interfaceName = document.createElement("select");

                    const placeholder = document.createElement("option");
                    placeholder.value = "";
                    placeholder.textContent = "Interface auswählen";
                    placeholder.selected = !pool?.interfaceName;
                    interfaceName.append(placeholder);

                    device.interfaces.forEach((iface) => {
                        const option = document.createElement("option");
                        option.value = iface.name;
                        option.textContent = iface.name;
                        option.selected = iface.name === pool?.interfaceName;
                        interfaceName.append(option);
                    });

                    const dnsServer = input("text", pool?.dnsServer ?? "", 15);
                    dnsServer.placeholder = "z. B. 8.8.8.8";

                    const excludedAddresses = input(
                        "text",
                        pool?.excludedAddresses?.join(", ") ?? "",
                        512
                    );
                    excludedAddresses.placeholder = "z. B. 192.168.1.1, 192.168.1.10";

                    const remove = itemButton("DHCP-Pool entfernen", "remove");
                    remove.addEventListener("click", () => {
                        const index = dhcpPoolControls.findIndex(
                            (item) => item.name === name
                        );

                        if (index !== -1) {
                            dhcpPoolControls.splice(index, 1);
                        }

                        poolSection.remove();
                        updatePoolHeadings();
                    });

                    poolSection.append(
                        poolHeading,
                        field("Pool-Name", name),
                        field("Router-Interface", interfaceName),
                        field("DNS-Server (optional)", dnsServer),
                        field("Ausgeschlossene IP-Adressen (kommagetrennt)", excludedAddresses),
                        remove
                    );

                    poolList.append(poolSection);

                    dhcpPoolControls.push({
                        name,
                        interfaceName,
                        dnsServer,
                        excludedAddresses
                    });
                };

                const addButton = itemButton("DHCP-Pool hinzufügen", "add");
                addButton.addEventListener("click", () => addPool());

                if (savedPools.length > 0) {
                    savedPools.forEach((pool) => addPool(pool));
                } else {
                    addPool();
                }

                settings.append(poolList, addButton);
            }


            if (type === ProtocolType.Rip) {
                ripVersion = document.createElement("select");

                const version1 = document.createElement("option");
                version1.value = "1";
                version1.textContent = "Version 1";

                const version2 = document.createElement("option");
                version2.value = "2";
                version2.textContent = "Version 2";

                ripVersion.append(version1, version2);
                ripVersion.value = String(saved?.rip?.version ?? 2);

                ripNoAutoSummary = input("checkbox");
                ripNoAutoSummary.checked = saved?.rip?.noAutoSummary ?? true;

                settings.append(
                    field("RIP-Version", ripVersion),
                    field("No Auto Summary", ripNoAutoSummary)
                );

                const networks = document.createElement("div");
                networks.className = "configuration-network-list";

                const networkRows = document.createElement("div");

                const savedNetworks = saved?.rip?.networks ?? [];

                const networkEntries = savedNetworks.length > 0
                    ? savedNetworks.map((network) => ({ address: network.address }))
                    : [{ address: "" }];

                const saveRipNetworkValues = () => {
                    ripNetworkControls.forEach((control, index) => {
                        if (networkEntries[index]) {
                            networkEntries[index].address = control.value;
                        }
                    });
                };

                const renderNetworks = () => {
                    ripNetworkControls.length = 0;
                    networkRows.replaceChildren();

                    networkEntries.forEach((network, index) => {
                        const address = input("text", network.address, 15);
                        address.placeholder = "z. B. 192.168.10.0";

                        ripNetworkControls.push(address);

                        const networkGroup = document.createElement("div");
                        networkGroup.className = "configuration-network-list";

                        const heading = document.createElement("h4");
                        heading.textContent = `Netzwerk ${index + 1}`;

                        networkGroup.append(
                            heading,
                            this.validatedField(
                                `protocol:${type}.rip.networks.${index}.address`,
                                "Netzwerkadresse *",
                                address
                            )
                        );

                        if (index > 0) {
                            const removeButton = itemButton("RIP-Netzwerk entfernen", "remove");

                            removeButton.addEventListener("click", () => {
                                saveRipNetworkValues();
                                networkEntries.splice(index, 1);
                                renderNetworks();
                            });

                            networkGroup.append(removeButton);
                        }

                        networkRows.append(networkGroup);
                    });
                };

                const addNetworkButton = itemButton("RIP-Netzwerk hinzufügen", "add");

                addNetworkButton.addEventListener("click", () => {
                    saveRipNetworkValues();
                    networkEntries.push({ address: "" });
                    renderNetworks();
                });

                networks.append(networkRows, addNetworkButton);
                renderNetworks();

                settings.append(networks);
            }


            if (type === ProtocolType.Ospf) {
                const process = saved?.ospf?.processes?.[0];

                const processId = input("number", String(process?.processId ?? 1));
                processId.min = "1";
                processId.max = "65535";
                processId.step = "1";
                processId.addEventListener("input", () => {
                    const value = Number(processId.value);
                    if (processId.value !== "" && (!Number.isInteger(value) || value < 1 || value > 65535)) {
                        processId.setCustomValidity("Process ID muss eine ganze Zahl zwischen 1 und 65535 sein.");
                    } else {
                        processId.setCustomValidity("");
                    }
                });
                processId.min = "1";
                processId.max = "65535";

                const routerId = input("text", process?.routerId ?? "", 15);
                routerId.placeholder = "Automatische Auswahl";

                settings.append(
                    this.validatedField(
                        `protocol:${type}.ospf.processes.0.processId`,
                        "Process ID (Standard: 1)",
                        processId
                    ),
                    this.validatedField(
                        `protocol:${type}.ospf.processes.0.routerId`,
                        "Router ID (optional)",
                        routerId
                    )
                );

                const ospfNetworks = document.createElement("div");
                ospfNetworks.className = "configuration-network-list";

                const savedNetworks = process?.networks ?? [];

                const networkEntries = savedNetworks.length > 0
                    ? savedNetworks.map((network) => ({
                        address: network.address,
                        wildcardMask: network.wildcardMask,
                        area: network.area
                    }))
                    : [{ address: "", wildcardMask: "", area: "0" }];

                const networkRows = document.createElement("div");

                const saveOspfNetworkValues = () => {
                    ospfNetworkControls.forEach((control, index) => {
                        networkEntries[index].address = control.address.value;
                        networkEntries[index].wildcardMask = control.wildcardMask.value;
                        networkEntries[index].area = control.area.value;
                    });
                };

                const renderOspfNetworks = () => {
                    ospfNetworkControls.length = 0;
                    networkRows.replaceChildren();

                    networkEntries.forEach((network, index) => {
                        const address = input("text", network.address, 15);
                        address.placeholder = "z. B. 192.168.10.0";

                        const wildcardMask = input("text", network.wildcardMask, 15);
                        wildcardMask.placeholder = "z. B. 0.0.0.255";

                        const area = input("text", network.area, 10);
                        area.placeholder = "0";

                        ospfNetworkControls.push({ address, wildcardMask, area });

                        const networkGroup = document.createElement("div");
                        networkGroup.className = "configuration-network-list";

                        const heading = document.createElement("h4");
                        heading.textContent = `Netzwerk ${index + 1}`;

                        const removeButton = itemButton("OSPF-Netzwerk entfernen", "remove");
                        removeButton.disabled = networkEntries.length <= 1;

                        removeButton.addEventListener("click", () => {
                            saveOspfNetworkValues();
                            networkEntries.splice(index, 1);
                            renderOspfNetworks();
                        });

                        networkGroup.append(
                            heading,
                            this.validatedField(
                                `protocol:${type}.ospf.processes.0.networks.${index}.address`,
                                "Netzwerkadresse *",
                                address
                            ),
                            this.validatedField(
                                `protocol:${type}.ospf.processes.0.networks.${index}.wildcardMask`,
                                "Wildcard-Maske *",
                                wildcardMask
                            ),
                            this.validatedField(
                                `protocol:${type}.ospf.processes.0.networks.${index}.area`,
                                "Area *",
                                area
                            ),
                            removeButton
                        );

                        networkRows.append(networkGroup);
                    });
                };

                const addNetworkButton = itemButton("OSPF-Netzwerk hinzufügen", "add");

                addNetworkButton.addEventListener("click", () => {
                    saveOspfNetworkValues();

                    networkEntries.push({
                        address: "",
                        wildcardMask: "",
                        area: "0"
                    });

                    renderOspfNetworks();
                });

                ospfNetworks.append(networkRows, addNetworkButton);
                renderOspfNetworks();

                settings.append(ospfNetworks);

                const passiveDefault = input("checkbox");
                passiveDefault.checked = process?.passiveInterfaceDefault ?? false;

                settings.append(
                    field("Passive Interface Default (Standard: deaktiviert)", passiveDefault)
                );

                const passiveInterfaces = document.createElement("div");
                passiveInterfaces.className = "configuration-network-list";

                const passiveInterfaceHeading = document.createElement("h4");
                passiveInterfaceHeading.textContent = "Passive Interfaces";
                passiveInterfaces.append(passiveInterfaceHeading);

                const passiveInterfaceValues = new Map<string, boolean>(
                    Object.entries(process?.passiveInterfaces ?? {})
                );

                const renderPassiveInterfaces = () => {
                    passiveInterfaceControls.forEach((checkbox, name) => {
                        passiveInterfaceValues.set(name, checkbox.checked);
                    });

                    passiveInterfaceControls.clear();
                    passiveInterfaces.replaceChildren(passiveInterfaceHeading);

                    controls
                        .filter(({ enabled }) => enabled.checked)
                        .forEach(({ id }) => {
                            const iface = device.interfaces.find((item) => item.id === id);
                            if (!iface) {
                                return;
                            }

                            const checkbox = input("checkbox");
                            checkbox.checked = passiveInterfaceValues.get(iface.name) ?? false;

                            checkbox.setAttribute(
                                "aria-label",
                                `${iface.name}: Passive Interface`
                            );

                            passiveInterfaceControls.set(iface.name, checkbox);
                            passiveInterfaces.append(field(iface.name, checkbox));
                        });
                };

                controls.forEach(({ enabled }) => {
                    enabled.addEventListener("change", renderPassiveInterfaces);
                });

                renderPassiveInterfaces();

                settings.append(passiveInterfaces);
            }

            if (type === ProtocolType.StaticRoute) {
                const heading = document.createElement("h4");
                heading.textContent = "Statische Routen";
                settings.append(heading);

                const routeList = document.createElement("div");
                routeList.className = "configuration-network-list";

                const savedRoutes = saved?.staticRoutes?.routes ?? [];

                const updateRouteHeadings = () => {
                    routeList.querySelectorAll("h4").forEach((item, index) => {
                        item.textContent = `Statische Route ${index + 1}`;
                    });
                };

                const addRoute = (route?: {
                    destination: string;
                    subnetMask: string;
                    nextHop?: string;
                    outgoingInterface?: string;
                    administrativeDistance?: number;
                }) => {
                    const routeSection = document.createElement("section");
                    routeSection.className = "configuration-static-route";

                    const routeHeading = document.createElement("h4");
                    routeHeading.textContent = `Statische Route ${staticRouteControls.length + 1}`;

                    const destination = input("text", route?.destination ?? "", 15);
                    destination.placeholder = "z. B. 192.168.2.0";

                    const subnetMask = input("text", route?.subnetMask ?? "", 15);
                    subnetMask.placeholder = "z. B. 255.255.255.0";

                    const nextHop = input("text", route?.nextHop ?? "", 15);
                    nextHop.placeholder = "z. B. 192.168.1.2";

                    const outgoingInterface = document.createElement("select");

                    nextHop.addEventListener("input", () => {
                        if (nextHop.value.trim() !== "") {
                            outgoingInterface.value = "";
                        }
                    });

                    outgoingInterface.addEventListener("change", () => {
                        if (outgoingInterface.value !== "") {
                            nextHop.value = "";
                        }
                    });

                    const placeholder = document.createElement("option");
                    placeholder.value = "";
                    placeholder.textContent = "Kein Interface ausgewählt";
                    outgoingInterface.append(placeholder);

                    device.interfaces.forEach((iface) => {
                        const option = document.createElement("option");
                        option.value = iface.name;
                        option.textContent = iface.name;
                        option.selected = iface.name === route?.outgoingInterface;
                        outgoingInterface.append(option);
                    });

                    const administrativeDistance = input(
                        "number",
                        String(route?.administrativeDistance ?? 1)
                    );
                    administrativeDistance.min = "1";
                    administrativeDistance.max = "255";
                    administrativeDistance.placeholder = "1";

                    const remove = itemButton("Statische Route entfernen", "remove");

                    remove.addEventListener("click", () => {
                        const index = staticRouteControls.findIndex(
                            (item) => item.destination === destination
                        );

                        if (index !== -1) {
                            staticRouteControls.splice(index, 1);
                        }

                        routeSection.remove();
                        updateRouteHeadings();
                    });

                    routeSection.append(
                        routeHeading,
                        field("Zielnetzwerk", destination),
                        field("Subnetzmaske", subnetMask),
                        field("Next Hop (optional)", nextHop),
                        field("Ausgangsinterface (optional)", outgoingInterface),
                        field("Administrative Distanz", administrativeDistance),
                        remove
                    );

                    routeList.append(routeSection);

                    staticRouteControls.push({
                        destination,
                        subnetMask,
                        nextHop,
                        outgoingInterface,
                        administrativeDistance
                    });
                };

                if (savedRoutes.length > 0) {
                    savedRoutes.forEach((route) => addRoute(route));
                } else {
                    addRoute();
                }

                const addButton = itemButton("Statische Route hinzufügen", "add");
                addButton.addEventListener("click", () => addRoute());

                settings.append(routeList, addButton);
            }

            const readAcl = type === ProtocolType.Acl
                ? this.appendAclSettings(settings, device, saved?.acls ?? [])
                : undefined;
            const readNat = type === ProtocolType.Nat
                ? this.appendStaticNatSettings(settings, device, saved?.nat, protocolIndex)
                : undefined;

            return {
                type,
                enabled,
                settings,
                readAcl,
                readNat,
                ripVersion,
                ripNoAutoSummary,
                ripNetworkControls,
                dhcpPoolControls,
                ospfNetworkControls,
                staticRouteControls,
                passiveInterfaceControls,
                processId: type === ProtocolType.Ospf
                    ? settings.querySelector<HTMLInputElement>('input[type="number"]')
                    : undefined,
                routerId: type === ProtocolType.Ospf
                    ? settings.querySelector<HTMLInputElement>('input[type="text"]')
                    : undefined,
                passiveDefault: type === ProtocolType.Ospf
                    ? settings.querySelector<HTMLInputElement>('input[type="checkbox"]')
                    : undefined,
                savedProcesses
            };
        });

        const aclControl = routingControls.find(({ type }) => type === ProtocolType.Acl);
        const natControl = routingControls.find(({ type }) => type === ProtocolType.Nat);
        const patIndex = routingControls.findIndex(({ type }) => type === ProtocolType.Pat);
        const patControl = routingControls[patIndex];
        const readPat = patControl && this.appendPatSettings(
            patControl.settings,
            patControl.enabled,
            device,
            draft.protocols.find(({ type }) => type === ProtocolType.Pat)?.pat,
            patIndex,
            () => (aclControl?.enabled.checked ? aclControl.readAcl?.() ?? [] : []),
            () => (natControl?.enabled.checked ? natControl.readNat?.() : undefined)
        );

        if (!deviceProtocols.length) {
            protocols.append(document.createTextNode("Keine Protokolle für diesen Gerätetyp."));
        }

        content.append(protocols);
        form.append(content);


        const actions = document.createElement("footer"); actions.className = "configuration-actions";
        const cancel = button("Abbrechen"); cancel.className = "configuration-secondary";
        cancel.addEventListener("click", () => { if (!this.pending) { this.close(); } });
        this.submit = button("Speichern"); this.submit.type = "submit";
        actions.append(cancel, this.submit); form.append(actions);
        form.addEventListener("submit", (event) => {
            event.preventDefault(); if (this.pending) { return; }
            const configuration: DeviceConfiguration = {
                label: label.value.trim(), hostname: hostname.value.trim(),
                domainName: domain.value.trim(), username: username.value.trim(),
                enableSecret: enableSecret.value, consolePassword: consolePassword.value,
                vtyPassword: vtyPassword.value, banner: banner.value,
                interfaces: controls.map(({ id, enabled, ip, mask, description, switchport }, index) => ({
                    id, enabled: enabled.checked, ipAddress: ip.value.trim(), subnetMask: mask.value.trim(),
                    description: description.value.trim(), layer: draft.interfaces[index].layer,
                    ...(switchport ? {
                        portMode: switchport.mode.value as PortMode,
                        // Trunks haben kein Access-VLAN; leer = VLAN 1.
                        accessVlan: vlanSelected() && switchport.mode.value !== "trunk" && switchport.vlan.value
                            ? Number(switchport.vlan.value) : undefined
                    } : {})
                })),
                protocols: [...routingControls.map(({
                    type,
                    enabled,
                    readAcl,
                    readNat,
                    ripNetworkControls,
                    dhcpPoolControls,
                    ripVersion,
                    ripNoAutoSummary,
                    ospfNetworkControls,
                    passiveInterfaceControls,
                    processId,
                    routerId,
                    staticRouteControls,
                    passiveDefault
                }) => ({
                    type,
                    enabled: enabled.checked,
                    ...(readAcl ? { acls: readAcl() } : {}),
                    ...(readNat ? { nat: readNat() } : {}),
                    ...(type === ProtocolType.Pat && readPat ? { pat: readPat() } : {}),

                    ...(type === ProtocolType.Rip
                        ? {
                            rip: {
                                version: Number(ripVersion?.value ?? 2) as 1 | 2,
                                noAutoSummary: ripNoAutoSummary?.checked ?? true,
                                networks: ripNetworkControls.map((address) => ({
                                    address: address.value.trim()
                                }))
                            }
                        }
                        : {}),

                    ...(type === ProtocolType.Ospf
                        ? {
                            ospf: {
                                processes: [{
                                    processId: Number(processId?.value ?? 1),
                                    routerId: routerId?.value.trim() || undefined,
                                    networks: ospfNetworkControls.map((network) => ({
                                        address: network.address.value.trim(),
                                        wildcardMask: network.wildcardMask.value.trim(),
                                        area: network.area.value.trim()
                                    })),
                                    passiveInterfaceDefault: passiveDefault?.checked ?? false,
                                    passiveInterfaces: Object.fromEntries(
                                        Array.from(passiveInterfaceControls, ([name, checkbox]) => [
                                            name,
                                            checkbox.checked
                                        ])
                                    )
                                }]
                            }
                        }
                        : {}),
                    ...(type === ProtocolType.Dhcp
                        ? {
                            dhcp: {
                                pools: dhcpPoolControls.map((pool) => ({
                                    name: pool.name.value.trim(),
                                    interfaceName: pool.interfaceName.value,
                                    dnsServer: pool.dnsServer.value.trim() || undefined,
                                    excludedAddresses: pool.excludedAddresses.value
                                        .split(",")
                                        .map((address) => address.trim())
                                        .filter(Boolean)
                                }))
                            }
                        }
                        : {}),
                    ...(type === ProtocolType.StaticRoute
                        ? {
                            staticRoutes: {
                                routes: staticRouteControls.map((route) => ({
                                    destination: route.destination.value.trim(),
                                    subnetMask: route.subnetMask.value.trim(),
                                    nextHop: route.nextHop.value.trim() || undefined,
                                    outgoingInterface: route.outgoingInterface.value || undefined,
                                    administrativeDistance: Number(
                                        route.administrativeDistance.value || 1
                                    )
                                }))
                            }
                        }
                        : {})
                })),
                ...protocolControls.filter((item) => item.selected.checked).map(({ type, read }) => {
                    const settings = read();
                    return { type, enabled: isProtocolComplete(type, settings), ...(settings ? { settings } : {}) };
                })]
            };
            this.protocolTypes = configuration.protocols.map((item) => item.type);
            const errors = validateDeviceConfiguration(device, configuration, otherHostnames);
            if (errors.length) { this.showValidationErrors(errors); return; }
            this.clearValidationErrors(); this.pending = true;
            if (this.switchNotice) { this.switchNotice.hidden = true; }
            form.querySelectorAll<FormControl>("input, select, textarea, button").forEach((control) => {
                this.disabledBeforeSave.set(control, control.disabled); control.disabled = true;
            });
            this.submit!.textContent = "Wird gespeichert …";
            vscodeApi.postMessage({ type: "configureDevice", deviceId: device.id, configuration });
        });
        this.dialog.replaceChildren(this.resizer, form);
        this.root.classList.add("configuration-open");
        if (!this.dialog.open) { this.dialog.show(); }
        label.focus({ preventScroll: true });
    }

    private protocolItem(type: ProtocolType, checked: boolean, settings: ProtocolSettings | undefined) {
        const body = this.protocolPanel(type, settings);
        const { card, enabled, settings: panel, refresh } = protocolCard(
            type, checked, () => isProtocolComplete(type, body.read())
        );
        panel.append(body.element);
        panel.addEventListener("input", refresh);
        panel.addEventListener("change", refresh);
        return { element: card, control: { type, selected: enabled, read: body.read } satisfies ProtocolControl };
    }

    private protocolPanel(type: ProtocolType, settings: ProtocolSettings | undefined): { element: HTMLElement; read(): ProtocolSettings | undefined } {
        const element = document.createElement("div");
        const hint = (text: string) => { const p = document.createElement("p"); p.className = "configuration-note"; p.textContent = text; return p; };
        switch (type) {
            case ProtocolType.Vlan: return this.vlanPanel(element, settings, hint);
            case ProtocolType.Stp:
            case ProtocolType.Rstp: {
                const role = select([["auto", "Automatisch (empfohlen)"], ["primary", "Primary Root"],
                ["secondary", "Secondary Root (Backup)"], ["none", "Keine Root"]], settings?.rootRole ?? "auto");
                element.append(hint(type === ProtocolType.Rstp
                    ? "Rapid PVST+: konvergiert in wenigen Sekunden statt 30–50 s."
                    : "Klassisches PVST+ (802.1D). Für neue Netze ist RSTP empfohlen."),
                    this.validatedField(`protocol:${type}.rootRole`, "Root-Bridge-Rolle", role),
                    hint("Automatisch: Der Switch am Router (sonst mit den meisten Switch-Nachbarn) wird Primary Root."));
                return { element, read: () => ({ rootRole: role.value as ProtocolSettings["rootRole"] }) };
            }
            case ProtocolType.EtherChannel: {
                const mode = select([["active", "LACP active"], ["passive", "LACP passive"]], settings?.lacpMode ?? "active");
                element.append(this.validatedField(`protocol:${type}.lacpMode`, "LACP-Modus", mode),
                    hint("Wird automatisch aus mindestens zwei parallelen Links zum selben Switch gebildet. Mindestens eine Seite muss active sein."));
                return { element, read: () => ({ lacpMode: mode.value as ProtocolSettings["lacpMode"] }) };
            }
            default:
                element.append(hint("Für dieses Protokoll sind hier noch keine Angaben nötig."));
                return { element, read: () => undefined };
        }
    }

    private vlanPanel(element: HTMLElement, settings: ProtocolSettings | undefined, hint: (text: string) => HTMLElement) {
        const rows: { id: HTMLInputElement; name: HTMLInputElement }[] = [];
        const list = document.createElement("div"); list.className = "configuration-vlan-list";
        const error = document.createElement("p"); error.className = "configuration-field-error"; error.hidden = true;
        const addRow = (id = "", name = "") => {
            const row = document.createElement("div"); row.className = "configuration-vlan-row";
            const idInput = input("number", id); idInput.min = "2"; idInput.max = "4094"; idInput.placeholder = "ID";
            idInput.setAttribute("aria-label", "VLAN-ID");
            const nameInput = input("text", name, 32); nameInput.placeholder = "Name, z. B. Clients";
            nameInput.setAttribute("aria-label", "VLAN-Name");
            const remove = itemButton("", "remove");
            remove.classList.add("configuration-vlan-remove");
            remove.title = "VLAN entfernen";
            remove.setAttribute("aria-label", "VLAN entfernen");
            const entry = { id: idInput, name: nameInput };
            remove.addEventListener("click", () => {
                rows.splice(rows.indexOf(entry), 1); row.remove();
                // "input" bubbelt bis zum Formular: Status und Access-VLAN-Auswahl aktualisieren sich.
                list.dispatchEvent(new Event("input", { bubbles: true }));
            });
            row.append(idInput, nameInput, remove);
            list.append(row); rows.push(entry);
        };
        for (const vlan of settings?.vlans ?? []) { addRow(String(vlan.id), vlan.name); }
        const add = itemButton("VLAN hinzufügen", "add");
        add.classList.add("configuration-vlan-add");
        add.addEventListener("click", () => { addRow(); rows[rows.length - 1].id.focus(); });
        const native = input("number", String(settings?.nativeVlan ?? "")); native.min = "1"; native.max = "4094";

        element.append(hint("VLANs dieses Switches. Fehlende VLANs auf Transit-Switches ergänzt der Generator."),
            list, error, add,
            this.validatedField(`protocol:${ProtocolType.Vlan}.nativeVlan`, "Native VLAN (Trunks)", native),
            hint("Empfohlen: ein eigenes, unbenutztes VLAN wie 99 statt VLAN 1."));
        return {
            element,
            read: (): ProtocolSettings => {
                // Fehler einzelner Zeilen erscheinen gesammelt unter der Liste.
                rows.forEach((row, index) => {
                    this.fields.set(`protocol:${ProtocolType.Vlan}.vlans.${index}.id`, { control: row.id, error });
                    this.fields.set(`protocol:${ProtocolType.Vlan}.vlans.${index}.name`, { control: row.name, error });
                });
                return {
                    vlans: rows.filter((row) => row.id.value.trim())
                        .map((row) => ({ id: Number(row.id.value), name: row.name.value.trim() })),
                    nativeVlan: native.value.trim() ? Number(native.value) : undefined
                };
            }
        };
    }
}

function section(title: string): HTMLFieldSetElement {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend"); legend.textContent = title; fieldset.append(legend);
    return fieldset;
}
function layer3InterfaceSelect(device: Device, placeholder: string, value = ""): HTMLSelectElement {
    const select = document.createElement("select");
    select.append(new Option(placeholder, ""));
    for (const iface of device.interfaces) {
        if (iface.layer !== 2) {
            select.append(new Option(iface.name, iface.id));
        }
    }
    if (value && !Array.from(select.options).some((option) => option.value === value)) {
        select.append(new Option("Gespeichertes Interface nicht verfügbar", value));
    }
    select.value = value;
    return select;
}

function field(text: string, control: HTMLElement): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = control instanceof HTMLInputElement && control.type === "checkbox" ? "configuration-checkbox" : "";
    const caption = document.createElement("span"); caption.textContent = text;
    label.append(caption, control); return label;
}
function input(type: string, value = "", maxLength?: number): HTMLInputElement {
    const element = document.createElement("input"); element.type = type; element.value = value;
    element.autocomplete = type === "password" ? "new-password" : "off";
    if (maxLength !== undefined) { element.maxLength = maxLength; }
    return element;

    function numberInput(value: number): HTMLInputElement {
        const element = input("number", String(value));
        element.min = "1";
        return element;
    }
}
function protocolCard(type: ProtocolType, checked: boolean, isComplete = () => true) {
    const { label } = PROTOCOL_DISPLAY[type];
    const enabled = input("checkbox");
    enabled.checked = checked;
    enabled.setAttribute("aria-label", `${label} aktiviert`);

    const settings = document.createElement("div");
    settings.className = "configuration-protocol-settings";
    settings.id = `protocol-settings-${type}`;
    enabled.setAttribute("aria-controls", settings.id);

    const card = document.createElement("div");
    card.className = "configuration-protocol-card";
    const toggle = field(label, enabled);
    toggle.classList.add("configuration-protocol-switch");
    const status = document.createElement("span");
    status.className = "configuration-protocol-status";
    status.setAttribute("aria-hidden", "true");
    toggle.insertBefore(status, enabled);
    card.append(toggle, settings);

    const refresh = () => {
        const active = enabled.checked;
        const incomplete = active && !isComplete();
        card.dataset.enabled = String(active);
        status.classList.toggle("configuration-protocol-incomplete", incomplete);
        status.textContent = incomplete ? "Unvollständig" : active ? "Aktiv" : "Aus";
        settings.hidden = !active;
    };
    enabled.addEventListener("change", refresh);
    refresh();
    return { card, enabled, settings, refresh };
}

function itemButton(text: string, action: "add" | "remove"): HTMLButtonElement {
    const control = button(text);
    control.className = `configuration-${action}-item`;
    return control;
}

function button(text: string): HTMLButtonElement {
    const result = document.createElement("button"); result.type = "button"; result.textContent = text;
    return result;
}
function select(options: [string, string][], value: string): HTMLSelectElement {
    const element = document.createElement("select");
    for (const [optionValue, text] of options) { element.add(new Option(text, optionValue, false, optionValue === value)); }
    return element;
}
/** Behält die bisherige Auswahl, solange das VLAN noch existiert. */
function fillVlanSelect(element: HTMLSelectElement, vlans: { id: number; name: string }[]): void {
    const current = element.value || element.dataset.value || "";
    element.replaceChildren(new Option("VLAN 1 (Default)", ""));
    for (const vlan of vlans) {
        if (Number.isInteger(vlan.id) && vlan.id > 1) { element.add(new Option(`${vlan.id} – ${vlan.name || "ohne Name"}`, String(vlan.id))); }
    }
    element.value = [...element.options].some((option) => option.value === current) ? current : "";
    delete element.dataset.value;
}
function setChecked(element: HTMLInputElement, checked: boolean): void {
    if (element.checked !== checked) { element.checked = checked; element.dispatchEvent(new Event("change", { bubbles: true })); }
}
