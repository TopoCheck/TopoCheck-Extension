import { DeviceType } from "../models/deviceType";
import { InterfaceType } from "../models/interfaceType";
import { NetworkDevice, compatibleProtocols } from "../models/networkDevice";
import { NetworkInterface } from "../models/networkInterface";
import { NetworkProtocol } from "../models/networkProtocol";
import { ProtocolType } from "../models/protocolType";
import type { Device } from "../modules/topology/models";
import { DeviceConfigurationValidationError, validateDeviceConfiguration } from "./validateDeviceConfiguration";
import type { DeviceAccessConfiguration } from "../models/deviceAccessConfiguration";
import { RipProtocol, OspfProtocol, StaticRouteProtocol, DhcpProtocol } from "../models/ciscoProtocols";

export interface DeviceConfiguration extends DeviceAccessConfiguration {
    label?: string;
    hostname: string;
    interfaces: {
        id: string;
        enabled: boolean;
        ipAddress: string;
        subnetMask: string;
        description?: string;
        layer?: 2 | 3;
    }[];
    protocols: {
        type: ProtocolType;
        enabled: boolean;
        rip?: {
            version: 1 | 2;
            noAutoSummary: boolean;
            networks: { address: string }[];
        };
        ospf?: {
            processes: {
                processId: number;
                routerId?: string;
                networks: {
                    address: string;
                    wildcardMask: string;
                    area: string;
                }[];
                passiveInterfaceDefault: boolean;
                passiveInterfaces: Record<string, boolean>;
            }[];
        };
        dhcp?: {
            pools: {
                name: string;
                interfaceName: string;
                dnsServer?: string;
                excludedAddresses?: string[];
            }[];
        };
        staticRoutes?: {
            routes: {
                destination: string;
                subnetMask: string;
                nextHop?: string;
                outgoingInterface?: string;
                administrativeDistance?: number;
            }[];
        };
    }[];
}

export { compatibleProtocols };

function isRipConfiguration(value: unknown): boolean {
    if (!value || typeof value !== "object") { return false; }

    const config = value as Record<string, unknown>;

    return (config.version === undefined ||
        config.version === 1 ||
        config.version === 2) &&
        (config.noAutoSummary === undefined ||
            typeof config.noAutoSummary === "boolean") &&
        Array.isArray(config.networks) &&
        config.networks.length <= 1024 &&
        config.networks.every((network: unknown) => {
            if (!network || typeof network !== "object") { return false; }
            const item = network as Record<string, unknown>;
            return typeof item.address === "string" &&
                item.address.length <= 32;
        });
}

function isOspfConfiguration(value: unknown): boolean {
    if (!value || typeof value !== "object") { return false; }

    const config = value as Record<string, unknown>;

    return Array.isArray(config.processes) &&
        config.processes.length <= 32 &&
        config.processes.every((process: unknown) => {
            if (!process || typeof process !== "object") { return false; }
            const item = process as Record<string, unknown>;

            return Number.isInteger(item.processId) &&
                (item.routerId === undefined ||
                    (typeof item.routerId === "string" && item.routerId.length <= 32)) &&
                Array.isArray(item.networks) &&
                item.networks.length <= 1024 &&
                item.networks.every((network: unknown) => {
                    if (!network || typeof network !== "object") { return false; }
                    const entry = network as Record<string, unknown>;

                    return typeof entry.address === "string" &&
                        entry.address.length <= 32 &&
                        typeof entry.wildcardMask === "string" &&
                        entry.wildcardMask.length <= 32 &&
                        typeof entry.area === "string" &&
                        entry.area.length <= 32;
                }) &&
                typeof item.passiveInterfaceDefault === "boolean" &&
                !!item.passiveInterfaces &&
                typeof item.passiveInterfaces === "object" &&
                !Array.isArray(item.passiveInterfaces) &&
                Object.entries(item.passiveInterfaces).every(
                    ([name, passive]) =>
                        name.length <= 128 && typeof passive === "boolean"
                );
        });
}

function isDhcpConfiguration(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const config = value as Record<string, unknown>;

    return Array.isArray(config.pools) &&
        config.pools.length <= 1024 &&
        config.pools.every((pool: unknown) => {
            if (!pool || typeof pool !== "object") {
                return false;
            }

            const item = pool as Record<string, unknown>;

            return typeof item.name === "string" &&
                item.name.length <= 128 &&
                typeof item.interfaceName === "string" &&
                item.interfaceName.length <= 128 &&
                (item.dnsServer === undefined ||
                    (typeof item.dnsServer === "string" &&
                        item.dnsServer.length <= 32)) &&
                (item.excludedAddresses === undefined ||
                    (Array.isArray(item.excludedAddresses) &&
                        item.excludedAddresses.length <= 1024 &&
                        item.excludedAddresses.every(
                            (address) =>
                                typeof address === "string" &&
                                address.length <= 32
                        )));
        });
}

function isStaticRoutesConfiguration(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const config = value as Record<string, unknown>;

    return Array.isArray(config.routes) &&
        config.routes.length <= 1024 &&
        config.routes.every((route: unknown) => {
            if (!route || typeof route !== "object") {
                return false;
            }

            const item = route as Record<string, unknown>;

            return typeof item.destination === "string" &&
                item.destination.length <= 32 &&
                typeof item.subnetMask === "string" &&
                item.subnetMask.length <= 32 &&
                (item.nextHop === undefined ||
                    (typeof item.nextHop === "string" &&
                        item.nextHop.length <= 32)) &&
                (item.outgoingInterface === undefined ||
                    (typeof item.outgoingInterface === "string" &&
                        item.outgoingInterface.length <= 128)) &&
                (item.administrativeDistance === undefined ||
                    (Number.isInteger(item.administrativeDistance) &&
                        (item.administrativeDistance as number) >= 1 &&
                        (item.administrativeDistance as number) <= 255));
        });
}

/** Runtime validation at the Webview boundary; semantic checks follow before saving. */
export function isDeviceConfiguration(value: unknown): value is DeviceConfiguration {
    if (!value || typeof value !== "object") { return false; }
    const data = value as Record<string, unknown>;
    return typeof data.hostname === "string" && data.hostname.length <= 253 &&
        ["label", "domainName", "username", "enableSecret", "consolePassword", "vtyPassword", "banner"]
            .every((key) => data[key] === undefined || (typeof data[key] === "string" && (data[key] as string).length <= 8192)) &&
        Array.isArray(data.interfaces) && data.interfaces.length <= 1024 &&
        data.interfaces.every((item: unknown) => {
            if (!item || typeof item !== "object") { return false; }
            const iface = item as Record<string, unknown>;
            return typeof iface.id === "string" && iface.id.length <= 128 &&
                typeof iface.enabled === "boolean" &&
                (iface.description === undefined || (typeof iface.description === "string" && iface.description.length <= 4096)) &&
                (iface.layer === undefined || iface.layer === 2 || iface.layer === 3) &&
                typeof iface.ipAddress === "string" && iface.ipAddress.length <= 32 &&
                typeof iface.subnetMask === "string" && iface.subnetMask.length <= 32;
        }) && Array.isArray(data.protocols) && data.protocols.length <= 32 &&
        data.protocols.every((item: unknown) => {
            if (!item || typeof item !== "object") { return false; }
            const protocol = item as Record<string, unknown>;
            return Object.values(ProtocolType).includes(protocol.type as ProtocolType) &&
                typeof protocol.enabled === "boolean" &&
                (protocol.rip === undefined || isRipConfiguration(protocol.rip)) &&
                (protocol.ospf === undefined || isOspfConfiguration(protocol.ospf)) &&
                (protocol.dhcp === undefined || isDhcpConfiguration(protocol.dhcp)) &&
                (protocol.staticRoutes === undefined || isStaticRoutesConfiguration(protocol.staticRoutes)) &&
                (protocol.type === ProtocolType.Rip
                    ? protocol.ospf === undefined
                    : protocol.rip === undefined) &&
                (protocol.type === ProtocolType.Ospf
                    ? protocol.rip === undefined
                    : protocol.ospf === undefined) &&
                (protocol.type === ProtocolType.Dhcp
                    ? protocol.rip === undefined &&
                      protocol.ospf === undefined &&
                      protocol.staticRoutes === undefined
                    : protocol.dhcp === undefined) &&
                (protocol.type === ProtocolType.StaticRoute
                    ? protocol.rip === undefined &&
                      protocol.ospf === undefined &&
                      protocol.dhcp === undefined
                    : protocol.staticRoutes === undefined);
        });
}

export function configurationOf(device: Device, connectedInterfaceIds: readonly string[] = []): DeviceConfiguration {
    return {
        label: device.label,
        hostname: device.hostname,
        domainName: device.domainName ?? "", username: device.username ?? "",
        enableSecret: device.enableSecret ?? "", consolePassword: device.consolePassword ?? "",
        vtyPassword: device.vtyPassword ?? "", banner: device.banner ?? "",
        interfaces: device.interfaces.map((iface) => ({
            id: iface.id, enabled: iface.enabled ?? connectedInterfaceIds.includes(iface.id),
            ipAddress: iface.ipAddress ?? "", subnetMask: iface.subnetMask ?? "",
            description: iface.description ?? "", layer: iface.layer ?? (device.type === "switch" ? 2 : 3)
        })),
        protocols: (device.protocols ?? []).map((protocol) => {
            const result: DeviceConfiguration["protocols"][number] = {
                type: protocol.type,
                enabled: protocol.enabled
            };

            if (protocol.rip !== undefined) {
                result.rip = {
                    version: protocol.rip.version ?? 2,
                    noAutoSummary: protocol.rip.noAutoSummary ?? true,
                    networks: protocol.rip.networks.map((network) => ({
                        address: network.address
                    }))
                };
            }

            if (protocol.ospf !== undefined) {
                result.ospf = {
                    processes: protocol.ospf.processes.map((process) => ({
                        processId: process.processId,
                        routerId: process.routerId,
                        networks: process.networks.map((network) => ({
                            address: network.address,
                            wildcardMask: network.wildcardMask,
                            area: network.area
                        })),
                        passiveInterfaceDefault: process.passiveInterfaceDefault,
                        passiveInterfaces: { ...process.passiveInterfaces }
                    }))
                };
            }

            if (protocol.dhcp !== undefined) {
                result.dhcp = {
                    pools: protocol.dhcp.map((pool) => ({
                        name: pool.name,
                        interfaceName: pool.interfaceName,
                        dnsServer: pool.dnsServer,
                        excludedAddresses: pool.excludedAddresses
                            ? [...pool.excludedAddresses]
                            : undefined
                    }))
                };
            }

            if (protocol.staticRoutes !== undefined) {
                result.staticRoutes = {
                    routes: protocol.staticRoutes.map((route) => ({
                        destination: route.destination,
                        subnetMask: route.subnetMask,
                        nextHop: route.nextHop,
                        outgoingInterface: route.outgoingInterface,
                        administrativeDistance: route.administrativeDistance
                    }))
                };
            }

            return result;
        })
    };
}

/** Rehydrates a persisted device as real H1c classes, including defaults for old files. */
export function toNetworkDevice(device: Device, otherHostnames: string[] = [], connectedInterfaceIds: readonly string[] = []): NetworkDevice {
    return buildConfiguredDevice(device, configurationOf(device, connectedInterfaceIds), otherHostnames);
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
    const model = new NetworkDevice({
        id: device.id, hostname, type: device.type as DeviceType,
        domainName: data.domainName?.trim() || undefined, username: data.username?.trim() || undefined,
        enableSecret: data.enableSecret || undefined, consolePassword: data.consolePassword || undefined,
        vtyPassword: data.vtyPassword || undefined, banner: data.banner || undefined
    });
    for (const input of data.interfaces) {
        const original = device.interfaces.find((iface) => iface.id === input.id)!;
        const ip = input.ipAddress.trim();
        const mask = input.subnetMask.trim();
        model.addInterface(new NetworkInterface({
            id: original.id, name: original.name, type: original.type ?? interfaceTypeOf(original.name),
            enabled: input.enabled, ipAddress: ip || undefined, subnetMask: mask || undefined,
            description: input.description?.trim() || undefined,
            layer: input.layer ?? original.layer ?? (device.type === "switch" ? 2 : 3)
        }));
    }
    for (const protocol of data.protocols) {
        const id = device.protocols?.find(
            (item) => item.type === protocol.type
        )?.id ?? `${device.id}:${protocol.type}`;

        if (protocol.type === ProtocolType.Rip) {
            const rip = new RipProtocol(id);
            if (protocol.rip !== undefined) {
                rip.version = protocol.rip.version ?? 2;
                rip.noAutoSummary = protocol.rip.noAutoSummary ?? true;
                rip.networks.push(...protocol.rip.networks);
            }
            if (protocol.enabled) {
                rip.enable();
            } else {
                rip.disable();
            }
            model.addProtocol(rip);
        } else if (protocol.type === ProtocolType.Ospf) {
            const ospf = new OspfProtocol(id);
            if (protocol.ospf !== undefined) {
                ospf.processes.push(
                    ...protocol.ospf.processes.map((process) => ({
                        ...process,
                        networks: process.networks.map((network) => ({ ...network })),
                        passiveInterfaces: { ...process.passiveInterfaces }
                    }))
                );
            }
            if (protocol.enabled) {
                ospf.enable();
            } else {
                ospf.disable();
            }
            model.addProtocol(ospf);
            } else if (protocol.type === ProtocolType.Dhcp) {
            const dhcp = new DhcpProtocol(id);

            if (protocol.dhcp !== undefined) {
                dhcp.pools.push(
                    ...protocol.dhcp.pools.map((pool) => ({
                        ...pool,
                        excludedAddresses: pool.excludedAddresses
                            ? [...pool.excludedAddresses]
                            : undefined
                    }))
                );
            }

            if (protocol.enabled) {
                dhcp.enable();
            } else {
                dhcp.disable();
            }

            model.addProtocol(dhcp);
        } else if (protocol.type === ProtocolType.StaticRoute) {
            const staticRoutes = new StaticRouteProtocol(id);

            if (protocol.staticRoutes !== undefined) {
                staticRoutes.routes.push(
                    ...protocol.staticRoutes.routes.map((route) => ({
                        ...route
                    }))
                );
            }

            if (protocol.enabled) {
                staticRoutes.enable();
            } else {
                staticRoutes.disable();
            }

            model.addProtocol(staticRoutes);
        } else {
            model.addProtocol(new NetworkProtocol({
                id,
                ...protocol
            }));
        }
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
