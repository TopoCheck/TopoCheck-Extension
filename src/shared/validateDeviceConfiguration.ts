import { DeviceType } from "../models/deviceType";
import { InterfaceType } from "../models/interfaceType";
import { isValidIpv4Address, isValidSubnetMask } from "../models/ipv4";
import { compatibleProtocols } from "../models/networkDevice";
import { ProtocolType } from "../models/protocolType";
import { isHostnameTaken, validateHostname } from "../modules/topology/hostname";
import type { Device } from "../modules/topology/models";
import type { DeviceConfiguration } from "./deviceConfiguration";

export interface ConfigurationFieldError {
    /** Indexed field paths, e.g. interfaces.0.ipAddress; suitable for any UI. */
    field: string;
    code: string;
    message: string;
}

export class DeviceConfigurationValidationError extends Error {
    constructor(readonly errors: ConfigurationFieldError[]) {
        super(errors.map((error) => error.message).join("\n"));
        this.name = "DeviceConfigurationValidationError";
    }
}

/** Pure semantic validation: collect all field errors, never mutate data or access VS Code. */
export function validateDeviceConfiguration(device: Device | undefined, data: DeviceConfiguration,
    otherHostnames: readonly string[] = []): ConfigurationFieldError[] {
    const errors: ConfigurationFieldError[] = [];
    const add = (field: string, code: string, message: string) => { errors.push({ field, code, message }); };
    if (!device) {
        add("deviceId", "device-not-found", "Das Gerät existiert nicht mehr. Bitte die Topologie erneut öffnen.");
        return errors;
    }
    if (!device.id.trim()) { add("deviceId", "device-id-empty", "Die Geräte-ID darf nicht leer sein."); }
    const validDeviceType = Object.values(DeviceType).includes(device.type as DeviceType);
    if (!validDeviceType) { add("deviceId", "device-type-invalid", "Der Gerätetyp wird nicht unterstützt."); }
    const hostname = data.hostname.trim();
    const hostnameError = validateHostname(hostname);
    if (hostnameError) { add("hostname", "hostname-invalid", hostnameError); }
    else if (isHostnameTaken(hostname, otherHostnames)) {
        add("hostname", "hostname-taken", `Der Hostname "${hostname}" ist bereits vergeben.`);
    }
    if (data.label !== undefined && (!data.label.trim() || data.label.trim().length > 128)) {
        add("label", "label-invalid", "Der Name muss ausgefüllt und darf höchstens 128 Zeichen lang sein.");
    }
    const domain = data.domainName?.trim();
    if (domain && (domain.length > 253 || !domain.split(".").every((part) =>
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part)))) {
        add("domainName", "domain-name-invalid", "Bitte einen gültigen Domain-Namen angeben, z. B. schule.at.");
    }
    if (data.username && (data.username.trim().length > 64 || /\s/.test(data.username.trim()))) {
        add("username", "username-invalid", "Der Benutzername darf höchstens 64 Zeichen und keine Leerzeichen enthalten.");
    }
    for (const key of ["enableSecret", "consolePassword", "vtyPassword"] as const) {
        if (data[key] && (data[key]!.length > 128 || /[\x00-\x1f\x7f]/.test(data[key]!))) {
            add(key, "password-invalid", "Das Passwort darf höchstens 128 Zeichen und keine Steuerzeichen enthalten.");
        }
    }
    if (data.banner && (data.banner.length > 4096 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(data.banner))) {
        add("banner", "banner-invalid", "Der Banner darf höchstens 4096 Zeichen und keine Steuerzeichen außer Zeilenumbrüchen/Tabulatoren enthalten.");
    }

    const ids = new Set<string>();
    const names = new Set<string>();
    data.interfaces.forEach((input, index) => {
        const field = `interfaces.${index}`;
        const original = device.interfaces.find((iface) => iface.id === input.id && iface.deviceId === device.id);
        if (!original) {
            add(`${field}.id`, "interface-not-found", "Das ausgewählte Interface gehört nicht zu diesem Gerät oder existiert nicht mehr.");
        }
        if (ids.has(input.id)) { add(`${field}.id`, "interface-duplicate", "Ein Interface darf nur einmal ausgewählt werden."); }
        ids.add(input.id);
        const name = original?.name ?? input.id;
        if (original) {
            if (!original.id.trim()) { add(`${field}.id`, "interface-id-empty", "Die Interface-ID darf nicht leer sein."); }
            if (!original.name.trim() || names.has(original.name.trim())) {
                add(`${field}.id`, "interface-name-invalid", "Interface-Namen müssen ausgefüllt und pro Gerät eindeutig sein.");
            }
            names.add(original.name.trim());
            if (original.type !== undefined && !Object.values(InterfaceType).includes(original.type)) {
                add(`${field}.id`, "interface-type-invalid", `${name}: Der Interfacetyp wird nicht unterstützt.`);
            }
        }
        const ip = input.ipAddress.trim();
        const mask = input.subnetMask.trim();
        if (input.description && (input.description.length > 240 || /[\x00-\x1f\x7f]/.test(input.description))) {
            add(`${field}.description`, "description-invalid", `${name}: Die Beschreibung darf höchstens 240 Zeichen und keine Steuerzeichen enthalten.`);
        }
        if (input.layer !== undefined && input.layer !== 2 && input.layer !== 3) {
            add(`${field}.layer`, "layer-invalid", `${name}: Bitte Layer 2 oder Layer 3 auswählen.`);
        }
        if (ip && !mask) {
            add(`${field}.subnetMask`, "subnet-mask-required", `${name}: Bitte zur IP-Adresse eine Subnetzmaske angeben.`);
        }
        if (mask && !ip) {
            add(`${field}.ipAddress`, "ip-address-required", `${name}: Bitte zur Subnetzmaske eine IP-Adresse angeben.`);
        }
        if (ip && !isValidIpv4Address(ip)) {
            add(`${field}.ipAddress`, "ip-address-invalid", `${name}: Ungültige IPv4-Adresse. Beispiel: 192.168.1.10.`);
        }
        if (mask && !isValidSubnetMask(mask)) {
            add(`${field}.subnetMask`, "subnet-mask-invalid", `${name}: Ungültige Subnetzmaske; Netzbits müssen zusammenhängend sein (z. B. 255.255.255.0).`);
        }
    });
    if (device.interfaces.some((iface) => !ids.has(iface.id))) {
        add("interfaces", "interfaces-incomplete", "Die Interfaceauswahl ist unvollständig oder veraltet. Bitte das Formular erneut öffnen.");
    }

    const protocols = new Set<ProtocolType>();
    data.protocols.forEach((protocol, index) => {
        const field = `protocols.${index}.type`;
        if (!Object.values(ProtocolType).includes(protocol.type)) {
            add(field, "protocol-unknown", "Das ausgewählte Protokoll wird nicht unterstützt.");
        } else if (validDeviceType && !compatibleProtocols[device.type as DeviceType].includes(protocol.type)) {
            add(field, "protocol-incompatible", `Das Protokoll ${protocol.type.toUpperCase()} ist für dieses Gerät nicht verfügbar.`);
        }
        if (protocols.has(protocol.type)) { add(field, "protocol-duplicate", "Ein Protokoll darf nur einmal ausgewählt werden."); }
        protocols.add(protocol.type);
    });
    return errors;
}
