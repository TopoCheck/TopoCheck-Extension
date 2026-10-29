import { DeviceType } from "../models/deviceType";
import { InterfaceType } from "../models/interfaceType";
import { NetworkDevice, compatibleProtocols } from "../models/networkDevice";
import { NetworkInterface } from "../models/networkInterface";
import { NetworkProtocol } from "../models/networkProtocol";
import { ProtocolType } from "../models/protocolType";
import type { Device } from "../modules/topology/models";
import { DeviceConfigurationValidationError, validateDeviceConfiguration } from "./validateDeviceConfiguration";

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

/** Rehydrates a persisted device as real H1c classes, including defaults for old files. */
export function toNetworkDevice(device: Device, otherHostnames: string[] = []): NetworkDevice {
    return buildConfiguredDevice(device, configurationOf(device), otherHostnames);
}

/** Builds a validated H1c model without mutating the stored device or its IDs. */
export function buildConfiguredDevice(device: Device, data: DeviceConfiguration,
    otherHostnames: string[]): NetworkDevice {
    if (!isDeviceConfiguration(data)) {
        throw new DeviceConfigurationValidationError([
            { field: "configuration", code: "configuration-invalid", message: "Ungültige Konfigurationsdaten." }
        ]);
    }
    const errors = validateDeviceConfiguration(device, data, otherHostnames);
    if (errors.length) { throw new DeviceConfigurationValidationError(errors); }
    const hostname = data.hostname.trim();
    const model = new NetworkDevice({ id: device.id, hostname, type: device.type as DeviceType });
    for (const input of data.interfaces) {
        const original = device.interfaces.find((iface) => iface.id === input.id)!;
        const ip = input.ipAddress.trim();
        const mask = input.subnetMask.trim();
        model.addInterface(new NetworkInterface({
            id: original.id, name: original.name, type: original.type ?? interfaceTypeOf(original.name),
            enabled: input.enabled, ipAddress: ip || undefined, subnetMask: mask || undefined
        }));
    }
    for (const protocol of data.protocols) {
        model.addProtocol(new NetworkProtocol({
            id: device.protocols?.find((item) => item.type === protocol.type)?.id ?? `${device.id}:${protocol.type}`,
            ...protocol
        }));
    }
    return model;
}

function interfaceTypeOf(name: string): InterfaceType {
    if (/^(gigabit|gi)/i.test(name)) { return InterfaceType.GigabitEthernet; }
    if (/^(fast|fa)/i.test(name)) { return InterfaceType.FastEthernet; }
    if (/^(loopback|lo)/i.test(name)) { return InterfaceType.Loopback; }
    if (/^vlan/i.test(name)) { return InterfaceType.Vlan; }
    return InterfaceType.Ethernet;
}
