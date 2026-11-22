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

// ---------------------------------------------------------------------------
// Typen und Konstanten
// ---------------------------------------------------------------------------

type Report = (field: string, code: string, message: string) => void;
type ProtocolConfiguration = DeviceConfiguration["protocols"][number];

const MAX_LABEL_LENGTH = 128;
const MAX_DOMAIN_LENGTH = 253;
const MAX_USERNAME_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 128;
const MAX_BANNER_LENGTH = 4096;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_OSPF_PROCESS_ID = 65535;
const MAX_OSPF_AREA = 4294967295;

const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** Alle Steuerzeichen (C0 und DEL). */
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;
/** Steuerzeichen außer Tab, LF und CR (für mehrzeilige Texte wie den Banner). */
const CONTROL_CHARACTERS_EXCEPT_WHITESPACE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

const PASSWORD_FIELDS = ["enableSecret", "consolePassword", "vtyPassword"] as const;

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Die Daten kommen zur Laufzeit ungeprüft an (z. B. per Webview-Message): fehlende Arrays tolerieren. */
function list<T>(value: readonly T[] | undefined | null): readonly T[] {
    return Array.isArray(value) ? value : [];
}

/** Getrimmter String; fehlende oder falsch typisierte Werte werden zu "". */
function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function isDeviceType(value: unknown): value is DeviceType {
    return Object.values(DeviceType).includes(value as DeviceType);
}

function ipv4ToNumber(ip: string): number {
    return ip.split(".").map(Number).reduce((result, octet) => result * 256 + octet, 0);
}

function hasLeadingZeros(ip: string): boolean {
    return /(^|\.)0\d/.test(ip);
}

/** Wildcard-Masken müssen zusammenhängend sein (0.0.0.255, 0.0.15.255, ...). */
function isValidWildcardMask(mask: string): boolean {
    if (!isValidIpv4Address(mask)) {
        return false;
    }

    const wildcard = ipv4ToNumber(mask);

    return ((wildcard & ((wildcard + 1) >>> 0)) >>> 0) === 0;
}

/** OSPF-Area: Dezimalzahl 0–4294967295 oder IPv4-Schreibweise (z. B. 0.0.0.0). */
function isValidOspfArea(area: string): boolean {
    if (/^\d+$/.test(area)) {
        return Number(area) <= MAX_OSPF_AREA;
    }

    return isValidIpv4Address(area) && !hasLeadingZeros(area);
}

function isValidOspfRouterId(routerId: string): boolean {
    return isValidIpv4Address(routerId) && !hasLeadingZeros(routerId) && routerId !== "0.0.0.0";
}

function isValidDomainName(domain: string): boolean {
    return domain.length <= MAX_DOMAIN_LENGTH && domain.split(".").every((part) => DOMAIN_LABEL.test(part));
}

// ---------------------------------------------------------------------------
// Gerät
// ---------------------------------------------------------------------------

/** Prüft das Gerätemodell selbst (nicht die Eingabe). Liefert den Gerätetyp, falls gültig. */
function validateDeviceModel(device: Device, report: Report): DeviceType | undefined {
    if (!device.id.trim()) {
        report("deviceId", "device-id-empty", "Die Geräte-ID darf nicht leer sein.");
    }

    const deviceType = isDeviceType(device.type) ? device.type : undefined;
    if (!deviceType) {
        report("deviceId", "device-type-invalid", "Der Gerätetyp wird nicht unterstützt.");
    }

    const ids = new Set<string>();
    const names = new Set<string>();

    for (const iface of device.interfaces) {
        const name = iface.name.trim();

        if (!iface.id.trim() || ids.has(iface.id)) {
            report("interfaces", "interface-id-invalid", "Interface-IDs müssen ausgefüllt und pro Gerät eindeutig sein.");
        }
        ids.add(iface.id);

        if (!name || names.has(name)) {
            report("interfaces", "interface-name-invalid", "Interface-Namen müssen ausgefüllt und pro Gerät eindeutig sein.");
        }
        names.add(name);

        if (iface.type !== undefined && !Object.values(InterfaceType).includes(iface.type)) {
            report("interfaces", "interface-type-invalid", `${iface.name}: Der Interfacetyp wird nicht unterstützt.`);
        }
    }

    return deviceType;
}

// ---------------------------------------------------------------------------
// Allgemeine Einstellungen
// ---------------------------------------------------------------------------

function validateGeneral(data: DeviceConfiguration, otherHostnames: readonly string[], report: Report): void {
    const hostname = text(data.hostname);
    const hostnameError = validateHostname(hostname);

    if (hostnameError) {
        report("hostname", "hostname-invalid", hostnameError);
    } else if (isHostnameTaken(hostname, otherHostnames)) {
        report("hostname", "hostname-taken", `Der Hostname "${hostname}" ist bereits vergeben.`);
    }

    if (data.label !== undefined) {
        const label = text(data.label);
        if (!label || label.length > MAX_LABEL_LENGTH) {
            report("label", "label-invalid", `Der Name muss ausgefüllt und darf höchstens ${MAX_LABEL_LENGTH} Zeichen lang sein.`);
        }
    }

    const domain = text(data.domainName);
    if (domain && !isValidDomainName(domain)) {
        report("domainName", "domain-name-invalid", "Bitte einen gültigen Domain-Namen angeben, z. B. schule.at.");
    }

    const username = text(data.username);
    if (username && (username.length > MAX_USERNAME_LENGTH || /\s/.test(username))) {
        report("username", "username-invalid", `Der Benutzername darf höchstens ${MAX_USERNAME_LENGTH} Zeichen und keine Leerzeichen enthalten.`);
    }

    for (const key of PASSWORD_FIELDS) {
        const value = data[key];
        if (value && (value.length > MAX_PASSWORD_LENGTH || CONTROL_CHARACTERS.test(value))) {
            report(key, "password-invalid", `Das Passwort darf höchstens ${MAX_PASSWORD_LENGTH} Zeichen und keine Steuerzeichen enthalten.`);
        }
    }

    if (data.banner && (data.banner.length > MAX_BANNER_LENGTH || CONTROL_CHARACTERS_EXCEPT_WHITESPACE.test(data.banner))) {
        report("banner", "banner-invalid", `Der Banner darf höchstens ${MAX_BANNER_LENGTH} Zeichen und keine Steuerzeichen außer Zeilenumbrüchen/Tabulatoren enthalten.`);
    }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface AssignedSubnet {
    name: string;
    address: number;
    start: number;
    end: number;
}

function validateInterfaces(device: Device, data: DeviceConfiguration, report: Report): void {
    const selectedIds = new Set<string>();
    const assigned: AssignedSubnet[] = [];

    list(data.interfaces).forEach((input, index) => {
        const field = `interfaces.${index}`;
        const original = device.interfaces.find((iface) => iface.id === input.id && iface.deviceId === device.id);

        if (!original) {
            report(`${field}.id`, "interface-not-found", "Das ausgewählte Interface gehört nicht zu diesem Gerät oder existiert nicht mehr.");
        }

        if (selectedIds.has(input.id)) {
            report(`${field}.id`, "interface-duplicate", "Ein Interface darf nur einmal ausgewählt werden.");
            return;
        }
        selectedIds.add(input.id);

        const name = original?.name ?? input.id;

        if (input.description && (input.description.length > MAX_DESCRIPTION_LENGTH || CONTROL_CHARACTERS.test(input.description))) {
            report(`${field}.description`, "description-invalid", `${name}: Die Beschreibung darf höchstens ${MAX_DESCRIPTION_LENGTH} Zeichen und keine Steuerzeichen enthalten.`);
        }

        if (input.layer !== undefined && input.layer !== 2 && input.layer !== 3) {
            report(`${field}.layer`, "layer-invalid", `${name}: Bitte Layer 2 oder Layer 3 auswählen.`);
        }

        validateInterfaceAddress(input, field, name, assigned, report);
    });

    if (device.interfaces.some((iface) => !selectedIds.has(iface.id))) {
        report("interfaces", "interfaces-incomplete", "Die Interfaceauswahl ist unvollständig oder veraltet. Bitte das Formular erneut öffnen.");
    }
}

function validateInterfaceAddress(
    input: DeviceConfiguration["interfaces"][number],
    field: string,
    name: string,
    assigned: AssignedSubnet[],
    report: Report
): void {
    const ip = text(input.ipAddress);
    const mask = text(input.subnetMask);
    const ipValid = ip !== "" && isValidIpv4Address(ip);
    const maskValid = mask !== "" && isValidSubnetMask(mask);

    if (ip && !mask) {
        report(`${field}.subnetMask`, "subnet-mask-required", `${name}: Bitte zur IP-Adresse eine Subnetzmaske angeben.`);
    }
    if (mask && !ip) {
        report(`${field}.ipAddress`, "ip-address-required", `${name}: Bitte zur Subnetzmaske eine IP-Adresse angeben.`);
    }
    if (ip && !ipValid) {
        report(`${field}.ipAddress`, "ip-address-invalid", `${name}: Ungültige IPv4-Adresse. Beispiel: 192.168.1.10.`);
    }
    if (mask && !maskValid) {
        report(`${field}.subnetMask`, "subnet-mask-invalid", `${name}: Ungültige Subnetzmaske; Netzbits müssen zusammenhängend sein (z. B. 255.255.255.0).`);
    }

    if (input.layer === 2) {
        if (ip || mask) {
            report(`${field}.ipAddress`, "layer2-address-not-allowed", `${name}: Ein Layer-2-Interface kann keine IP-Adresse haben.`);
        }
        return;
    }

    if (!ipValid || !maskValid) {
        return;
    }

    const address = ipv4ToNumber(ip);
    const subnetMask = ipv4ToNumber(mask);
    const hostMask = (~subnetMask) >>> 0;
    const start = (address & subnetMask) >>> 0;
    const end = (start | hostMask) >>> 0;
    const firstOctet = address >>> 24;

    if (firstOctet === 0 || firstOctet === 127 || firstOctet >= 224) {
        report(`${field}.ipAddress`, "ip-address-reserved", `${name}: Diese Adresse ist reserviert und kann keinem Interface zugewiesen werden.`);
        return;
    }

    // /31 und /32 haben keine Netzwerk- bzw. Broadcast-Adresse im klassischen Sinn.
    if (hostMask > 1) {
        if (address === start) {
            report(`${field}.ipAddress`, "ip-address-is-network", `${name}: Die Adresse ist die Netzwerkadresse des Subnetzes und keine gültige Host-Adresse.`);
            return;
        }
        if (address === end) {
            report(`${field}.ipAddress`, "ip-address-is-broadcast", `${name}: Die Adresse ist die Broadcast-Adresse des Subnetzes und keine gültige Host-Adresse.`);
            return;
        }
    }

    const sameAddress = assigned.find((other) => other.address === address);
    if (sameAddress) {
        report(`${field}.ipAddress`, "ip-address-duplicate", `${name}: Die IP-Adresse wird bereits von ${sameAddress.name} verwendet.`);
        return;
    }

    const overlapping = assigned.find((other) => start <= other.end && other.start <= end);
    if (overlapping) {
        report(`${field}.ipAddress`, "subnet-overlap", `${name}: Das Subnetz überschneidet sich mit dem Subnetz von ${overlapping.name}.`);
        return;
    }

    assigned.push({ name, address, start, end });
}

// ---------------------------------------------------------------------------
// Protokolle
// ---------------------------------------------------------------------------

function validateProtocols(
    device: Device,
    deviceType: DeviceType | undefined,
    data: DeviceConfiguration,
    report: Report
): void {
    const seen = new Set<ProtocolType>();

    list(data.protocols).forEach((protocol, index) => {
        const field = `protocols.${index}`;

        if (!Object.values(ProtocolType).includes(protocol.type)) {
            report(`${field}.type`, "protocol-unknown", "Das ausgewählte Protokoll wird nicht unterstützt.");
        } else if (deviceType && !compatibleProtocols[deviceType].includes(protocol.type)) {
            report(`${field}.type`, "protocol-incompatible", `Das Protokoll ${protocol.type.toUpperCase()} ist für dieses Gerät nicht verfügbar.`);
        }

        if (seen.has(protocol.type)) {
            report(`${field}.type`, "protocol-duplicate", "Ein Protokoll darf nur einmal ausgewählt werden.");
        }
        seen.add(protocol.type);

        if (!protocol.enabled) {
            return;
        }

        if (protocol.type === ProtocolType.Rip) {
            validateRip(protocol, field, report);
        } else if (protocol.type === ProtocolType.Ospf) {
            validateOspf(protocol, field, report);
        } else if (protocol.type === ProtocolType.Acl) {
            const acls = protocol.acls ?? (protocol.acl === undefined ? undefined : [protocol.acl]);
            if (acls !== undefined) {
                validateAcls(device, data, acls, `${field}.acls`, report);
            }
        }
    });
}

function validateAcls(
    device: Device,
    data: DeviceConfiguration,
    acls: NonNullable<ProtocolConfiguration["acls"]>,
    field: string,
    report: Report
): void {
    if (!acls.length) {
        report(field, "acl-required", "Lege mindestens eine IPv4-ACL an.");
    }
    const names = new Set<string>();
    const bindings = new Set<string>();
    acls.forEach((acl, index) => {
        const aclField = `${field}.${index}`;
        const reportAcl: Report = (path, code, message) => report(path, code, `ACL ${index + 1}: ${message}`);
        validateAcl(device, data, acl, aclField, reportAcl);

        const name = acl.name.toLowerCase();
        if (name && names.has(name)) {
            reportAcl(`${aclField}.name`, "acl-name-duplicate", "Dieser ACL-Name ist bereits vergeben.");
        }
        names.add(name);
        if (acl.binding) {
            const key = `${acl.binding.interfaceId}:${acl.binding.direction}`;
            if (bindings.has(key)) {
                reportAcl(`${aclField}.binding.interfaceId`, "acl-binding-duplicate", "Das Interface ist in dieser Richtung bereits einer ACL zugewiesen.");
            }
            bindings.add(key);
        }
    });
}

function validateAcl(
    device: Device,
    data: DeviceConfiguration,
    acl: NonNullable<ProtocolConfiguration["acl"]>,
    field: string,
    report: Report
): void {
    if (acl.name !== acl.name.trim() || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(acl.name)) {
        report(`${field}.name`, "acl-name-invalid", "Der ACL-Name muss mit einem Buchstaben beginnen und darf Buchstaben, Ziffern, Bindestriche und Unterstriche enthalten.");
    }
    if (!acl.rules.length) {
        report(`${field}.rules`, "acl-rules-required", "Füge mindestens eine ACL-Regel hinzu.");
    }

    acl.rules.forEach((rule, index) => {
        const ruleField = `${field}.rules.${index}`;
        for (const [key, label, wildcard] of [
            ["source", "Quelle", rule.sourceWildcard],
            ["destination", "Ziel", rule.destinationWildcard]
        ] as const) {
            const address = rule[key];
            if (address !== "any" && !isAclIpv4(address)) {
                report(`${ruleField}.${key}`, "acl-address-invalid", `Regel ${index + 1}, ${label}: Gib eine IPv4-Adresse oder „any“ ein.`);
            }
            if (wildcard !== "" && (address === "any" || !isAclIpv4(wildcard))) {
                report(`${ruleField}.${key}Wildcard`, "acl-wildcard-invalid", `Regel ${index + 1}, ${label}: Gib eine gültige IPv4-Wildcard-Maske ein. Bei „any“ bleibt das Feld leer.`);
            }
        }
    });

    if (acl.binding) {
        const iface = device.interfaces.find(({ id }) => id === acl.binding?.interfaceId);
        const input = data.interfaces.find(({ id }) => id === acl.binding?.interfaceId);
        if (!iface || (input?.layer ?? iface.layer) === 2 ||
            iface.name !== iface.name.trim() || !/^[A-Za-z][A-Za-z0-9./-]*$/.test(iface.name)) {
            report(`${field}.binding.interfaceId`, "acl-interface-invalid", "Wähle ein gültiges Layer-3-Interface dieses Routers.");
        }
    }
}

function isAclIpv4(value: string): boolean {
    return value === value.trim() && isValidIpv4Address(value) && !hasLeadingZeros(value);
}

function validateRip(protocol: ProtocolConfiguration, field: string, report: Report): void {
    const networks = list(protocol.rip?.networks);

    if (networks.length === 0) {
        report(`${field}.rip.networks`, "rip-network-required", "Für RIP muss mindestens eine Netzwerkadresse angegeben werden.");
        return;
    }

    const seen = new Set<string>();
    let hasDuplicate = false;

    networks.forEach((network, index) => {
        const address = text(network.address);

        if (!isValidIpv4Address(address)) {
            report(`${field}.rip.networks.${index}.address`, "rip-network-invalid", "Bitte eine gültige IPv4-Netzwerkadresse angeben.");
        }

        if (seen.has(address)) {
            hasDuplicate = true;
        }
        seen.add(address);
    });

    if (hasDuplicate) {
        report(`${field}.rip.networks`, "rip-network-duplicate", "Ein RIP-Netzwerk wurde mehrfach angegeben.");
    }
}

function validateOspf(protocol: ProtocolConfiguration, field: string, report: Report): void {
    const processes = list(protocol.ospf?.processes);

    if (processes.length === 0) {
        report(`${field}.ospf.processes`, "ospf-process-required", "Für OSPF muss mindestens ein Prozess vorhanden sein.");
        return;
    }

    const processIds = new Set<number>();

    processes.forEach((ospfProcess, processIndex) => {
        const processField = `${field}.ospf.processes.${processIndex}`;

        const routerId = text(ospfProcess.routerId);
        if (routerId && !isValidOspfRouterId(routerId)) {
            report(`${processField}.routerId`, "ospf-router-id-invalid", "Bitte eine gültige OSPF Router-ID ohne führende Nullen angeben (nicht 0.0.0.0).");
        }

        const processId = ospfProcess.processId;
        if (!Number.isInteger(processId) || processId < 1 || processId > MAX_OSPF_PROCESS_ID) {
            report(`${processField}.processId`, "ospf-process-id-invalid", `Die OSPF Process ID muss eine ganze Zahl zwischen 1 und ${MAX_OSPF_PROCESS_ID} sein.`);
        } else if (processIds.has(processId)) {
            report(`${processField}.processId`, "ospf-process-id-duplicate", `Die OSPF Process ID ${processId} wurde mehrfach vergeben.`);
        } else {
            processIds.add(processId);
        }

        validateOspfNetworks(ospfProcess.networks, processField, report);
    });
}

function validateOspfNetworks(
    networks: readonly { address: string; wildcardMask: string; area: string }[] | undefined,
    processField: string,
    report: Report
): void {
    const entries = list(networks);

    if (entries.length === 0) {
        report(`${processField}.networks`, "ospf-network-required", "Für jeden OSPF-Prozess muss mindestens ein Netzwerk angegeben werden.");
        return;
    }

    const seen = new Set<string>();
    let hasDuplicate = false;

    entries.forEach((network, index) => {
        const networkField = `${processField}.networks.${index}`;
        const address = text(network.address);
        const wildcardMask = text(network.wildcardMask);
        const area = text(network.area);

        const addressValid = isValidIpv4Address(address);
        const wildcardValid = isValidWildcardMask(wildcardMask);

        if (!addressValid) {
            report(`${networkField}.address`, "ospf-network-invalid", "Bitte eine gültige IPv4-Netzwerkadresse angeben.");
        }

        if (!wildcardValid) {
            report(`${networkField}.wildcardMask`, "ospf-wildcard-invalid", "Bitte eine gültige zusammenhängende OSPF-Wildcard-Maske angeben.");
        }

        if (!isValidOspfArea(area)) {
            report(`${networkField}.area`, "ospf-area-invalid", "Die OSPF Area muss eine Zahl zwischen 0 und 4294967295 oder im Format 0.0.0.0 angegeben werden.");
        }

        const key = `${address}|${wildcardMask}|${area}`;
        if (seen.has(key)) {
            hasDuplicate = true;
        }
        seen.add(key);
    });

    if (hasDuplicate) {
        report(`${processField}.networks`, "ospf-network-duplicate", "Ein OSPF-Netzwerk wurde mehrfach mit derselben Wildcard-Maske und Area angegeben.");
    }
}

// ---------------------------------------------------------------------------
// Einstiegspunkt
// ---------------------------------------------------------------------------

/** Pure semantic validation: collect all field errors, never mutate data or access VS Code. */
export function validateDeviceConfiguration(
    device: Device | undefined,
    data: DeviceConfiguration,
    otherHostnames: readonly string[] = []
): ConfigurationFieldError[] {
    const errors: ConfigurationFieldError[] = [];
    const report: Report = (field, code, message) => {
        errors.push({ field, code, message });
    };

    if (!device) {
        report("deviceId", "device-not-found", "Das Gerät existiert nicht mehr. Bitte die Topologie erneut öffnen.");
        return errors;
    }

    const deviceType = validateDeviceModel(device, report);
    validateGeneral(data, otherHostnames, report);
    validateInterfaces(device, data, report);
    validateProtocols(device, deviceType, data, report);

    return errors;
}
