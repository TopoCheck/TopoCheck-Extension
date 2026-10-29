/**
 * 
 * Datenmodell
 * 
 */

import type { Point } from "../../shared/geometry";
import type { ProtocolType } from "../../models/protocolType";

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
}

export interface DeviceConfig {
    id: string;
    deviceId: string;
    filePath: string;
    updatedAt: string;
}

export interface Device {
    id: string;
    topologyId: string;
    label: string;
    hostname: string;
    type: DeviceType;
    interfaces: Interface[];
    config?: DeviceConfig;
    protocols?: { id: string; type: ProtocolType; enabled: boolean }[];
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
