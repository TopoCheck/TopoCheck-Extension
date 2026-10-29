import { DeviceType } from "../models/deviceType";
import { InterfaceType } from "../models/interfaceType";
import { NetworkDevice, compatibleProtocols } from "../models/networkDevice";
import { NetworkInterface } from "../models/networkInterface";
import { NetworkProtocol } from "../models/networkProtocol";
import { ProtocolType } from "../models/protocolType";
import type { Device } from "../modules/topology/models";
import { isHostnameTaken, validateHostname } from "../modules/topology/hostname";

export interface DeviceConfiguration {
    hostname: string;
    interfaces: { id: string; enabled: boolean; ipAddress: string; subnetMask: string }[];
    protocols: { type: ProtocolType; enabled: boolean }[];
}

export { compatibleProtocols };

/** Runtime validation at the Webview boundary; semantic checks follow before saving. */
export function isDeviceConfiguration(value: unknown): value is DeviceConfiguration {
    if (!value || typeof value !== "object") { return false; }
    const data = value as Record<string, unknown>;
    return typeof data.hostname === "string" && data.hostname.length <= 253 &&
        Array.isArray(data.interfaces) && data.interfaces.length <= 1024 &&
        data.interfaces.every((item: unknown) => {
            if (!item || typeof item !== "object") { return false; }
            const iface = item as Record<string, unknown>;
            return typeof iface.id === "string" && iface.id.length <= 128 &&
                typeof iface.enabled === "boolean" &&
                typeof iface.ipAddress === "string" && iface.ipAddress.length <= 32 &&
                typeof iface.subnetMask === "string" && iface.subnetMask.length <= 32;
        }) && Array.isArray(data.protocols) && data.protocols.length <= 32 &&
        data.protocols.every((item: unknown) => {
            if (!item || typeof item !== "object") { return false; }
            const protocol = item as Record<string, unknown>;
            return Object.values(ProtocolType).includes(protocol.type as ProtocolType) &&
                typeof protocol.enabled === "boolean";
        });
}

export function configurationOf(device: Device): DeviceConfiguration {
    return {
        hostname: device.hostname,
        interfaces: device.interfaces.map((iface) => ({
            id: iface.id, enabled: iface.enabled ?? true,
            ipAddress: iface.ipAddress ?? "", subnetMask: iface.subnetMask ?? ""
        })),
        protocols: (device.protocols ?? []).map(({ type, enabled }) => ({ type, enabled }))
    };
}

/** Builds a validated H1c model without mutating the stored device or its IDs. */
export function buildConfiguredDevice(device: Device, data: DeviceConfiguration,
    otherHostnames: string[]): NetworkDevice {
    if (!isDeviceConfiguration(data)) { throw new Error("Ungültige Konfigurationsdaten."); }
    const hostname = data.hostname.trim();
    const hostnameError = validateHostname(hostname);
    if (hostnameError) { throw new Error(hostnameError); }
    if (isHostnameTaken(hostname, otherHostnames)) {
        throw new Error(`Der Hostname "${hostname}" ist bereits vergeben.`);
    }
    if (data.interfaces.length !== device.interfaces.length ||
        new Set(data.interfaces.map((iface) => iface.id)).size !== data.interfaces.length) {
        throw new Error("Die Interfaceauswahl ist veraltet. Bitte das Formular erneut öffnen.");
    }
    const model = new NetworkDevice({ id: device.id, hostname, type: device.type as DeviceType });
    for (const input of data.interfaces) {
        const original = device.interfaces.find((iface) => iface.id === input.id);
        if (!original) { throw new Error("Unbekanntes Interface. Bitte das Formular erneut öffnen."); }
        const ip = input.ipAddress.trim();
        const mask = input.subnetMask.trim();
        const prefix = `${original.name}: `;
        if (Boolean(ip) !== Boolean(mask)) {
            throw new Error(prefix + "IP-Adresse und Subnetzmaske müssen gemeinsam angegeben werden.");
        }
        if (ip && !validIpv4(ip)) { throw new Error(prefix + "Ungültige IPv4-Adresse."); }
        if (mask && (!validIpv4(mask) || !/^1*0*$/.test(mask.split(".")
            .map((part) => Number(part).toString(2).padStart(8, "0")).join("")))) {
            throw new Error(prefix + "Ungültige Subnetzmaske; Netzbits müssen zusammenhängend sein.");
        }
        model.addInterface(new NetworkInterface({
            id: original.id, name: original.name, type: interfaceTypeOf(original.name),
            enabled: input.enabled, ipAddress: ip || undefined, subnetMask: mask || undefined
        }));
    }
    for (const protocol of data.protocols) {
        if (!compatibleProtocols[model.type].includes(protocol.type)) {
            throw new Error(`Das Protokoll ${protocol.type.toUpperCase()} ist für dieses Gerät nicht verfügbar.`);
        }
        if (model.protocols.some((item) => item.type === protocol.type)) {
            throw new Error("Ein Protokoll darf nur einmal ausgewählt werden.");
        }
        model.addProtocol(new NetworkProtocol({
            id: device.protocols?.find((item) => item.type === protocol.type)?.id ?? `${device.id}:${protocol.type}`,
            ...protocol
        }));
    }
    return model;
}

function validIpv4(value: string): boolean {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) &&
        value.split(".").every((part) => Number(part) <= 255);
}

function interfaceTypeOf(name: string): InterfaceType {
    if (/^(gigabit|gi)/i.test(name)) { return InterfaceType.GigabitEthernet; }
    if (/^(fast|fa)/i.test(name)) { return InterfaceType.FastEthernet; }
    if (/^(loopback|lo)/i.test(name)) { return InterfaceType.Loopback; }
    if (/^vlan/i.test(name)) { return InterfaceType.Vlan; }
    return InterfaceType.Ethernet;
}
