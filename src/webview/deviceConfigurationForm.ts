import type { Device } from "../modules/topology/models";
import { DeviceType } from "../models/deviceType";
import { ProtocolType } from "../models/protocolType";
import { compatibleProtocols, configurationOf, DeviceConfiguration } from "../shared/deviceConfiguration";
import { ConfigurationFieldError, validateDeviceConfiguration } from "../shared/validateDeviceConfiguration";
import type { ExtensionToWebviewMessage } from "../shared/protocol";
import { DEVICE_TYPE_LABEL, iconHref } from "./icons";
import { svgElement } from "./svg";
import { vscodeApi } from "./vscodeApi";

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
    private readonly interfaceCards = new Map<string, { card: HTMLElement; status: HTMLElement }>();
    private connectedIds = new Set<string>();
    private showAllInterfaces: HTMLInputElement | undefined;
    private emptyInterfaces: HTMLElement | undefined;

    constructor(private readonly root: HTMLElement) {
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
                this.connectedIds = new Set(message.topology.connections.flatMap((connection) =>
                    [connection.interfaceAId, connection.interfaceBId]));
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
        for (const [id, { card, status }] of this.interfaceCards) {
            const connected = this.connectedIds.has(id);
            card.hidden = !this.showAllInterfaces?.checked && !connected;
            status.textContent = connected ? "Verbunden" : "Frei";
            if (!card.hidden) { visible++; }
        }
        if (this.emptyInterfaces) {
            this.emptyInterfaces.hidden = visible > 0;
            this.emptyInterfaces.textContent = this.interfaceCards.size
                ? "Keine Interfaces verbunden. Mit „Alle Interfaces anzeigen“ kannst du freie Ports einblenden."
                : "Keine Interfaces vorhanden.";
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
        const draft = configurationOf(device);
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
        const helper = document.createElement("p");
        helper.className = "configuration-note";
        helper.textContent = "Verbundene Ports · IP-Adresse und Maske gemeinsam optional";
        interfaces.append(helper);
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
        const controls = device.interfaces.map((iface, index) => {
            const card = document.createElement("section"); card.className = "configuration-interface-card";
            const cardHeader = document.createElement("header"); cardHeader.className = "configuration-interface-header";
            const name = document.createElement("h3"); name.textContent = iface.name;
            cardHeader.append(name);
            const status = document.createElement("span"); status.className = "configuration-port-status";
            status.textContent = connectedIds.includes(iface.id) ? "Verbunden" : "Frei";
            const enabled = input("checkbox"); enabled.checked = draft.interfaces[index].enabled;
            enabled.setAttribute("aria-label", `${iface.name}: Aktiviert`);
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
            interfaces.append(card);
            this.interfaceCards.set(iface.id, { card, status });
            return { id: iface.id, enabled, ip, mask, description };
        });
        this.emptyInterfaces = document.createElement("p");
        this.emptyInterfaces.className = "configuration-note";
        interfaces.append(this.emptyInterfaces);
        this.updateInterfaceVisibility();
        content.append(interfaces);

        const protocols = section("Protokolle");
        const protocolControls = compatibleProtocols[device.type as DeviceType].map((type: ProtocolType) => {
            const saved = draft.protocols.find((item) => item.type === type);
            const selected = input("checkbox"); selected.checked = saved !== undefined;
            const enabled = input("checkbox"); enabled.checked = saved?.enabled ?? true;
            enabled.disabled = !selected.checked; enabled.setAttribute("aria-label", `${type.toUpperCase()} aktiviert`);
            selected.addEventListener("change", () => { enabled.disabled = !selected.checked; });
            const row = document.createElement("div"); row.className = "configuration-protocol";
            row.append(field(type.toUpperCase(), selected), field("Aktiviert", enabled));
            protocols.append(row);
            return { type, selected, enabled };
        });
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
                interfaces: controls.map(({ id, enabled, ip, mask, description }, index) => ({
                    id, enabled: enabled.checked, ipAddress: ip.value.trim(), subnetMask: mask.value.trim(),
                    description: description.value.trim(), layer: draft.interfaces[index].layer
                })),
                protocols: protocolControls.filter((item) => item.selected.checked)
                    .map(({ type, enabled }) => ({ type, enabled: enabled.checked }))
            };
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
        this.dialog.replaceChildren(form);
        this.root.classList.add("configuration-open");
        if (!this.dialog.open) { this.dialog.show(); }
        label.focus({ preventScroll: true });
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
