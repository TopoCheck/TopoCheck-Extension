/**
 * Adapter: gespeicherte Topologie -> Eingabe des Switching-Generators.
 *
 * VLANs werden wie in der Praxis je Switch eingetragen. Der Generator braucht ein
 * einheitliches VLAN-Design, daher werden die Listen hier zusammengeführt;
 * Widersprüche zwischen Switches werden als Warnung gemeldet, nicht stillschweigend gelöst.
 */

import { DeviceType } from "../../models/deviceType";
import { InterfaceType } from "../../models/interfaceType";
import { ProtocolType } from "../../models/protocolType";
import type { Device, Topology } from "../../modules/topology/models";
import { naturalCompare } from "./planSwitching";
import type { SwitchingTopologyInput, SwitchingVlan, SwitchingWarning } from "./types";

export function switchingInputFromTopology(topology: Topology): { input: SwitchingTopologyInput; warnings: SwitchingWarning[] } {
    const warnings: SwitchingWarning[] = [];
    const switches = topology.devices
        .filter((device) => device.type === "switch")
        .sort((a, b) => naturalCompare(a.hostname, b.hostname));

    const vlans = new Map<number, SwitchingVlan & { owner: string }>();
    let nativeVlan: { id: number; owner: string } | undefined;
    for (const device of switches) {
        const vlan = enabledProtocol(device, ProtocolType.Vlan);
        if (!vlan?.settings) { continue; }
        for (const { id, name } of vlan.settings.vlans ?? []) {
            const existing = vlans.get(id);
            if (!existing) {
                vlans.set(id, { id, name, owner: device.hostname });
            } else if (existing.name !== name) {
                warnings.push({
                    code: "VLAN_NAME_CONFLICT", deviceId: device.id,
                    message: `VLAN ${id} heißt auf ${existing.owner} "${existing.name}", auf ${device.hostname} "${name}" – "${existing.name}" wird verwendet.`
                });
            }
        }
        const native = vlan.settings.nativeVlan;
        if (native === undefined) { continue; }
        if (!nativeVlan) {
            nativeVlan = { id: native, owner: device.hostname };
        } else if (nativeVlan.id !== native) {
            // In der Praxis führt das zu einem Native-VLAN-Mismatch (CDP-Meldung, Datenverkehr landet im falschen VLAN).
            warnings.push({
                code: "NATIVE_VLAN_MISMATCH", deviceId: device.id,
                message: `Native VLAN ${native} auf ${device.hostname} weicht von VLAN ${nativeVlan.id} auf ${nativeVlan.owner} ab – VLAN ${nativeVlan.id} wird für alle Trunks verwendet.`
            });
        }
    }

    const deviceOfInterface = new Map<string, string>();
    for (const device of topology.devices) {
        for (const iface of device.interfaces) { deviceOfInterface.set(iface.id, device.id); }
    }

    const input: SwitchingTopologyInput = {
        vlans: [...vlans.values()].map(({ id, name }) => ({ id, name })),
        nativeVlan: nativeVlan?.id,
        devices: topology.devices.map((device) => ({
            id: device.id,
            hostname: device.hostname,
            type: device.type as DeviceType,
            protocols: (device.protocols ?? []).filter((p) => p.enabled).map((p) => p.type),
            rootRole: (enabledProtocol(device, ProtocolType.Rstp) ?? enabledProtocol(device, ProtocolType.Stp))?.settings?.rootRole,
            lacpMode: enabledProtocol(device, ProtocolType.EtherChannel)?.settings?.lacpMode,
            interfaces: device.interfaces.map((iface) => ({
                id: iface.id,
                name: iface.name,
                type: iface.type ?? interfaceTypeOf(iface.name),
                accessVlan: iface.accessVlan,
                portMode: iface.portMode
                // subinterfaceVlans: folgt, sobald H3a Router-Subinterfaces speichert.
            }))
        })),
        connections: topology.connections.flatMap((connection) => {
            const a = deviceOfInterface.get(connection.interfaceAId);
            const b = deviceOfInterface.get(connection.interfaceBId);
            return a && b ? [{
                id: connection.id,
                a: { deviceId: a, interfaceId: connection.interfaceAId },
                b: { deviceId: b, interfaceId: connection.interfaceBId }
            }] : [];
        })
    };
    return { input, warnings };
}

function enabledProtocol(device: Device, type: ProtocolType) {
    return device.protocols?.find((protocol) => protocol.type === type && protocol.enabled);
}

function interfaceTypeOf(name: string): InterfaceType {
    if (/^(gigabit|gi)/i.test(name)) { return InterfaceType.GigabitEthernet; }
    if (/^(fast|fa)/i.test(name)) { return InterfaceType.FastEthernet; }
    return InterfaceType.Ethernet;
}
