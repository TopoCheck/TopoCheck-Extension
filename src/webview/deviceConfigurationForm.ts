import type { Device, PortMode, ProtocolSettings } from "../modules/topology/models";
import { DeviceType } from "../models/deviceType";
import { ProtocolType } from "../models/protocolType";
import { compatibleProtocols, configurationOf, DeviceConfiguration } from "../shared/deviceConfiguration";
import { ConfigurationFieldError, validateDeviceConfiguration } from "../shared/validateDeviceConfiguration";
import type { ExtensionToWebviewMessage } from "../shared/protocol";
import { DEVICE_TYPE_LABEL, iconHref } from "./icons";
import { svgElement } from "./svg";
import { vscodeApi } from "./vscodeApi";
import { defaultSettings, isProtocolComplete } from "../shared/switchingSettings";

const PROTOCOL_LABEL: Partial<Record<ProtocolType, string>> = {
    [ProtocolType.Vlan]: "VLAN", [ProtocolType.Stp]: "STP", [ProtocolType.Rstp]: "RSTP",
    [ProtocolType.EtherChannel]: "EtherChannel"
};
const MIN_WIDTH = 280;

export interface FormWidthStore { initialWidth?: number; saveWidth(width: number): void }

/** Ein Protokolleintrag im Formular; read() liefert die aktuellen Eingaben. */
interface ProtocolControl {
    type: ProtocolType;
    selected: HTMLInputElement;
    read(): ProtocolSettings | undefined;
    refresh(): void;
}

type FieldControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type FormControl = FieldControl | HTMLButtonElement;

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
        if (!this.switchNotice) { return; }
        this.switchNotice.replaceChildren();
        const message = document.createElement("p");
        message.textContent = text;
        const yes = button("Verwerfen");
        yes.addEventListener("click", discard);
        const no = button("Weiter bearbeiten");
        no.addEventListener("click", () => { this.switchNotice!.hidden = true; });
        this.switchNotice.append(message, yes, no);
        this.switchNotice.hidden = false;
        this.switchNotice.scrollIntoView({ block: "nearest" });
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
        errors = errors.map((issue) => ({
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
        const protocolControls: ProtocolControl[] = compatibleProtocols[device.type as DeviceType].map((type: ProtocolType) => {
            const saved = draft.protocols.find((item) => item.type === type);
            const settings = saved?.settings ?? defaultSettings(type);
            const item = this.protocolItem(type, saved !== undefined, settings);
            protocols.append(item.element);
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
        if (!protocolControls.length) { protocols.append(document.createTextNode("Keine Protokolle für diesen Gerätetyp.")); }
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
                protocols: protocolControls.filter((item) => item.selected.checked).map(({ type, read }) => {
                    const settings = read();
                    return { type, enabled: isProtocolComplete(type, settings), ...(settings ? { settings } : {}) };
                })
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

    /** Zeile "☐ VLAN … Aktiviert" mit aufklappbarem Formular darunter. */
    private protocolItem(type: ProtocolType, checked: boolean, settings: ProtocolSettings | undefined) {
        const element = document.createElement("div"); element.className = "configuration-protocol";
        const row = document.createElement("div"); row.className = "configuration-protocol-row";
        const selected = input("checkbox"); selected.checked = checked;
        selected.setAttribute("aria-label", `${PROTOCOL_LABEL[type] ?? type.toUpperCase()} verwenden`);
        const toggle = button(PROTOCOL_LABEL[type] ?? type.toUpperCase()); toggle.className = "configuration-protocol-toggle";
        const badge = document.createElement("span"); badge.className = "configuration-protocol-badge";
        const panel = document.createElement("div"); panel.className = "configuration-protocol-panel";
        panel.id = `protocol-panel-${type}`; panel.hidden = true;
        toggle.setAttribute("aria-controls", panel.id);
        row.append(selected, toggle, badge);

        const body = this.protocolPanel(type, settings);
        panel.append(body.element);
        const refresh = () => {
            const complete = isProtocolComplete(type, body.read());
            badge.textContent = !selected.checked ? "" : complete ? "Aktiviert" : "Unvollständig";
            badge.dataset.state = complete ? "complete" : "incomplete";
        };
        let expanded = false;
        const expand = (open: boolean) => { expanded = open; panel.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); };
        toggle.addEventListener("click", () => expand(!expanded));
        // Auswählen klappt die Eingaben auf, Abwählen wieder zu.
        selected.addEventListener("change", () => { expand(selected.checked); refresh(); });
        panel.addEventListener("input", refresh);
        panel.addEventListener("change", refresh);
        expand(false); refresh();
        element.append(row, panel);
        return { element, control: { type, selected, read: body.read, refresh } satisfies ProtocolControl };
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
            const remove = button("×"); remove.className = "configuration-vlan-remove";
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
        const add = button("+ VLAN hinzufügen"); add.className = "configuration-secondary configuration-vlan-add";
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
