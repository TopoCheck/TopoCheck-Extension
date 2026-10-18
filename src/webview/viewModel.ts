
/**
 * Aufbereitung der Topologie aus dem Store für die Darstellung.
 */

import type { DeviceType, Topology } from "../modules/topology/models";
import type { Point } from "../shared/geometry";

export interface ViewInterface {
    id: string;
    name: string;
    status: "up" | "down";
    deviceId: string;
    deviceHostname: string;
}

export interface ViewDevice {
    id: string;
    type: DeviceType;
    label: string;
    hostname: string;
    position: Point;
    interfaces: ViewInterface[];
}

export interface ViewConnection {
    id: string;
    deviceA: string;
    deviceB: string;
    interfaceAId: string;
    interfaceBId: string;
    interfaceAName: string;
    interfaceBName: string;
}

export interface ViewModel {
    name: string;
    devices: Map<string, ViewDevice>;
    connections: ViewConnection[];
}

export function toViewModel(topology: Topology): ViewModel {
    const devices = new Map<string, ViewDevice>();
    const deviceOfInterface = new Map<string, ViewInterface>();

    for (const device of topology.devices) {
        const interfaces: ViewInterface[] = device.interfaces.map((iface) => ({
            id: iface.id,
            name: iface.name,
            status: iface.status,
            deviceId: device.id,
            deviceHostname: device.hostname,
        }));

        const position = topology.layout.devices[device.id] ?? { x: 0, y: 0 };

        devices.set(device.id, {
            id: device.id,
            type: device.type,
            label: device.label,
            hostname: device.hostname,
            position,
            interfaces,
        });

        for (const iface of interfaces) {
            deviceOfInterface.set(iface.id, iface);
        }
    }

    const connections: ViewConnection[] = [];

    for (const connection of topology.connections) {
        const ifaceA = deviceOfInterface.get(connection.interfaceAId);
        const ifaceB = deviceOfInterface.get(connection.interfaceBId);

        if (ifaceA && ifaceB) {
            connections.push({
                id: connection.id,
                deviceA: ifaceA.deviceId,
                deviceB: ifaceB.deviceId,
                interfaceAId: ifaceA.id,
                interfaceBId: ifaceB.id,
                interfaceAName: ifaceA.name,
                interfaceBName: ifaceB.name,
            });
        }
    }

    return { name: topology.name, devices, connections };
}
