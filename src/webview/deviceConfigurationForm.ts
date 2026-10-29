import type { Device } from "../modules/topology/models";
import { DeviceType } from "../models/deviceType";
import { ProtocolType } from "../models/protocolType";
import { compatibleProtocols, configurationOf } from "../shared/deviceConfiguration";
import { ConfigurationFieldError, validateDeviceConfiguration } from "../shared/validateDeviceConfiguration";
import type { ExtensionToWebviewMessage } from "../shared/protocol";
import { vscodeApi } from "./vscodeApi";

/** The dialog owns a draft; only a successful extension acknowledgement closes it. */
export class DeviceConfigurationForm {
    private readonly dialog = document.createElement("dialog");
    private pending = false;
    private deviceId: string | undefined;
    private error: HTMLElement | undefined;
    private submit: HTMLButtonElement | undefined;
    private readonly disabledBeforeSave = new Map<HTMLInputElement | HTMLSelectElement | HTMLButtonElement, boolean>();
    private readonly fields = new Map<string, { control: HTMLInputElement; error: HTMLElement }>();
    private revealInterface: ((index: number) => void) | undefined;

    constructor(root: HTMLElement) {
        this.dialog.className = "device-configuration";
        this.dialog.setAttribute("aria-labelledby", "device-configuration-title");
        this.dialog.addEventListener("cancel", (event) => {
            if (this.pending) { event.preventDefault(); }
        });
        // Escape must not also clear selection or toggle tools in the canvas.
        this.dialog.addEventListener("keydown", (event) => event.stopPropagation());
        root.append(this.dialog);
    }

    receive(message: ExtensionToWebviewMessage): void {
        if (message.type === "editDevice") {
            // A duplicate double-click / delayed response must never replace an unsaved draft.
            if (!this.dialog.open) { this.open(message.device, message.otherHostnames); }
        } else if (message.type === "configurationResult" &&
            this.dialog.open && this.pending && message.deviceId === this.deviceId) {
            this.pending = false;
            for (const [control, disabled] of this.disabledBeforeSave) { control.disabled = disabled; }
            this.disabledBeforeSave.clear();
            if (this.submit) { this.submit.textContent = "Speichern"; }
            if (message.validationErrors?.length) { this.showValidationErrors(message.validationErrors); }
            else if (message.error) { this.showError(message.error); }
            else { this.dialog.close(); }
        }
    }

    private showError(message: string): void {
        if (this.error) {
            this.error.textContent = message;
            this.error.hidden = false;
            this.error.focus();
        }
    }

    private clearValidationErrors(): void {
        for (const { control, error } of this.fields.values()) {
            control.removeAttribute("aria-invalid");
            error.textContent = "";
            error.hidden = true;
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
            const index = /^interfaces\.(\d+)\./.exec(first.field)?.[1];
            if (index !== undefined) { this.revealInterface?.(Number(index)); }
            this.fields.get(first.field)!.control.focus();
        }
    }

    private validatedField(key: string, text: string, control: HTMLInputElement): HTMLElement {
        const wrapper = document.createElement("div");
        const error = document.createElement("p");
        error.id = `configuration-field-error-${this.fields.size}`;
        error.className = "configuration-field-error";
        error.hidden = true;
        control.setAttribute("aria-describedby", error.id);
        this.fields.set(key, { control, error });
        wrapper.append(field(text, control), error);
        return wrapper;
    }

    private open(device: Device, otherHostnames: string[]): void {
        this.deviceId = device.id;
        this.pending = false;
        this.fields.clear();
        this.revealInterface = undefined;
        const draft = configurationOf(device);
        const form = document.createElement("form");
        // Use the same German field validation as the extension, including required fields.
        form.noValidate = true;
        const title = document.createElement("h2");
        title.id = "device-configuration-title";
        title.textContent = `Gerät konfigurieren: ${device.hostname}`;
        const note = document.createElement("p");
        note.textContent = "* Pflichtfeld. IP-Adresse und Subnetzmaske sind gemeinsam optional.";
        this.error = document.createElement("p");
        this.error.className = "configuration-error";
        this.error.setAttribute("role", "alert");
        this.error.tabIndex = -1;
        this.error.hidden = true;
        form.append(title, note, this.error);

        const general = section("Gerät");
        const hostname = input("text", draft.hostname);
        hostname.required = true;
        hostname.maxLength = 63;
        hostname.autocomplete = "off";
        const type = document.createElement("p");
        type.textContent = `Gerätetyp: ${{ router: "Router", switch: "Switch", pc: "PC" }[device.type]}`;
        general.append(this.validatedField("hostname", "Hostname *", hostname), type);
        form.append(general);

        const interfaces = section("Interfaces");
        const select = document.createElement("select");
        const rows: HTMLElement[] = [];
        const controls = device.interfaces.map((iface, index) => {
            const option = document.createElement("option");
            option.value = String(index);
            option.textContent = iface.name;
            select.append(option);
            const row = document.createElement("div");
            row.hidden = index !== 0;
            const enabled = input("checkbox");
            enabled.checked = draft.interfaces[index].enabled;
            const ip = input("text", draft.interfaces[index].ipAddress);
            ip.placeholder = "z. B. 192.168.1.10";
            const mask = input("text", draft.interfaces[index].subnetMask);
            mask.placeholder = "z. B. 255.255.255.0";
            for (const control of [ip, mask]) { control.maxLength = 32; control.autocomplete = "off"; }
            row.append(field("Interface aktiviert", enabled),
                this.validatedField(`interfaces.${index}.ipAddress`, "IPv4-Adresse (optional)", ip),
                this.validatedField(`interfaces.${index}.subnetMask`, "Subnetzmaske (optional)", mask));
            rows.push(row);
            return { id: iface.id, enabled, ip, mask };
        });
        this.revealInterface = (selectedIndex) => {
            select.value = String(selectedIndex);
            rows.forEach((row, index) => { row.hidden = index !== selectedIndex; });
        };
        select.addEventListener("change", () => this.revealInterface!(Number(select.value)));
        if (rows.length) { interfaces.append(field("Interface auswählen", select), ...rows); }
        else {
            const empty = document.createElement("p");
            empty.textContent = "Keine Interfaces vorhanden.";
            interfaces.append(empty);
        }
        form.append(interfaces);

        const protocols = section("Protokolle (optional)");
        const protocolControls = compatibleProtocols[device.type as DeviceType].map((type: ProtocolType) => {
            const saved = draft.protocols.find((item) => item.type === type);
            const selected = input("checkbox");
            selected.checked = saved !== undefined;
            const enabled = input("checkbox");
            enabled.checked = saved?.enabled ?? true;
            enabled.disabled = !selected.checked;
            enabled.setAttribute("aria-label", `${type.toUpperCase()} aktiviert`);
            selected.addEventListener("change", () => { enabled.disabled = !selected.checked; });
            const row = document.createElement("div");
            row.className = "configuration-protocol";
            row.append(field(type.toUpperCase(), selected), field("Aktiviert", enabled));
            protocols.append(row);
            return { type, selected, enabled };
        });
        if (!protocolControls.length) {
            const empty = document.createElement("p");
            empty.textContent = "Für diesen Gerätetyp sind keine Protokolle verfügbar.";
            protocols.append(empty);
        }
        form.append(protocols);

        const actions = document.createElement("div");
        actions.className = "configuration-actions";
        this.submit = document.createElement("button");
        this.submit.type = "submit";
        this.submit.textContent = "Speichern";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Abbrechen";
        cancel.addEventListener("click", () => { if (!this.pending) { this.dialog.close(); } });
        actions.append(this.submit, cancel);
        form.append(actions);
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (this.pending) { return; }
            const configuration = {
                hostname: hostname.value.trim(),
                interfaces: controls.map(({ id, enabled, ip, mask }) => ({
                    id, enabled: enabled.checked, ipAddress: ip.value.trim(), subnetMask: mask.value.trim()
                })),
                protocols: protocolControls.filter((item) => item.selected.checked)
                    .map(({ type, enabled }) => ({ type, enabled: enabled.checked }))
            };
            const errors = validateDeviceConfiguration(device, configuration, otherHostnames);
            if (errors.length) { this.showValidationErrors(errors); return; }
            this.clearValidationErrors();
            this.pending = true;
            form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
                "input, select, button").forEach((control) => {
                    this.disabledBeforeSave.set(control, control.disabled);
                    control.disabled = true;
                });
            this.submit!.textContent = "Wird gespeichert …";
            vscodeApi.postMessage({ type: "configureDevice", deviceId: device.id, configuration });
        });
        this.dialog.replaceChildren(form);
        this.dialog.showModal();
        hostname.focus();
    }
}

function section(title: string): HTMLFieldSetElement {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = title;
    fieldset.append(legend);
    return fieldset;
}

function field(text: string, control: HTMLElement): HTMLLabelElement {
    const label = document.createElement("label");
    label.append(document.createTextNode(text), control);
    return label;
}

function input(type: string, value = ""): HTMLInputElement {
    const element = document.createElement("input");
    element.type = type;
    element.value = value;
    return element;
}
