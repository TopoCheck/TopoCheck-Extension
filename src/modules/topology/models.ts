/**
 * 
 * Datenmodell
 * 
 */

import type { Point } from "../../shared/geometry";
import type { ProtocolType } from "../../models/protocolType";
import type { InterfaceType } from "../../models/interfaceType";
import type { DeviceAccessConfiguration } from "../../models/deviceAccessConfiguration";

export type DeviceType = "router" | "switch" | "pc";
export type InterfaceStatus = "up" | "down";
export const CURRENT_SCHEMA_VERSION = 2;
export type Position = Point;

/**
 * Darstellungsdaten einer Topologie – bewusst getrennt vom Netzwerkmodell.
 */
export interface TopologyLayout {
    devices: Record<string, Position>;
}

export interface Interface {
    id: string;
    deviceId: string;
    name: string;
    status: InterfaceStatus;
    enabled?: boolean;
    ipAddress?: string;
    subnetMask?: string;
    /** Optional for older files; otherwise preserves the H1c type independently of the name. */
    type?: InterfaceType;
    description?: string;
    layer?: 2 | 3;
}

export interface DeviceConfig {
    id: string;
    deviceId: string;
    filePath: string;
    updatedAt: string;
}

export interface TopologyRipConfiguration {
    version?: 1 | 2;
    noAutoSummary?: boolean;
    networks: {
        address: string;
    }[];
}

export interface TopologyOspfConfiguration {
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
}

export interface DeviceProtocol {
    id: string;
    type: ProtocolType;
    enabled: boolean;
    rip?: TopologyRipConfiguration;
    ospf?: TopologyOspfConfiguration;
}

export interface Device extends DeviceAccessConfiguration {
    id: string;
    topologyId: string;
    label: string;
    hostname: string;
    type: DeviceType;
    interfaces: Interface[];
    config?: DeviceConfig;
    protocols?: DeviceProtocol[];
}

export interface Connection {
    id: string;
    topologyId: string;
    interfaceAId: string;
    interfaceBId: string;
}

export interface Topology {
    id: string;
    name: string;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
    devices: Device[];
    connections: Connection[];
    layout: TopologyLayout;
}
