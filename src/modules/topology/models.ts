/**
 * 
 * Datenmodell
 * 
 */

export type DeviceType = "router" | "switch" | "pc";
export type InterfaceStatus = "up" | "down";
export const CURRENT_SCHEMA_VERSION = 1;

export interface Interface {
    id: string;
    deviceId: string;
    name: string;
    status: InterfaceStatus;
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
}