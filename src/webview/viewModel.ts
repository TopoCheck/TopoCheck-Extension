/**
 * Aufbereitung der Topologie aus dem Store für die Darstellung.
 */

import type { DeviceType, Topology } from "../modules/topology/models";
import type { Point } from "../shared/geometry";

export interface ViewDevice {
    id: string;
    type: DeviceType;
    label: string;
    hostname: string;
    position: Point;
}

export interface ViewConnection {
    id: string;
    deviceA: string;
    deviceB: string;
}

export interface ViewModel {
    name: string;
    devices: Map<string, ViewDevice>;
    connections: ViewConnection[];
}

export function toViewModel(topology: Topology): ViewModel {
    const devices = new Map<string, ViewDevice>();
    const deviceOfInterface = new Map<string, string>();

    for (const device of topology.devices) {
        const position = topology.layout.devices[device.id] ?? { x: 0, y: 0 };
        devices.set(device.id, {
            id: device.id,
            type: device.type,
            label: device.label,
            hostname: device.hostname,
            position,
        });
        for (const iface of device.interfaces) {
            deviceOfInterface.set(iface.id, device.id);
        }
    }

    const connections: ViewConnection[] = [];
    for (const connection of topology.connections) {
        const deviceA = deviceOfInterface.get(connection.interfaceAId);
        const deviceB = deviceOfInterface.get(connection.interfaceBId);
        if (deviceA && deviceB) {
            connections.push({ id: connection.id, deviceA, deviceB });
        }
    }

    return { name: topology.name, devices, connections };
}
