import * as assert from "assert";
import { ProtocolType } from "../../models/protocolType";
import type { Device, Topology } from "../../modules/topology/models";
import { planSwitching, switchingInputFromTopology } from "../../generator/switching";

function switchDevice(id: string, protocols: Device["protocols"], access: Record<number, number> = {}): Device {
    return {
        id, topologyId: "t", hostname: id.toUpperCase(), label: id.toUpperCase(), type: "switch", protocols,
        interfaces: [1, 2, 3].map((n) => ({
            id: `${id}-fa${n}`, deviceId: id, name: `FastEthernet0/${n}`, status: "up" as const,
            accessVlan: access[n]
        }))
    };
}

function topology(devices: Device[], links: [string, string][]): Topology {
    return {
        id: "t", name: "Test", schemaVersion: 3, createdAt: "", updatedAt: "", layout: { devices: {} }, devices,
        connections: links.map(([a, b], index) => ({ id: `c${index}`, topologyId: "t", interfaceAId: a, interfaceBId: b }))
    };
}

const vlan = (vlans: { id: number; name: string }[], nativeVlan = 99) =>
    ({ id: "v", type: ProtocolType.Vlan, enabled: true, settings: { vlans, nativeVlan } });

suite("H3b Adapter Topologie → Generator", () => {
    test("übernimmt nur aktivierte Protokolle, Root-Rolle, LACP-Modus und Port-Angaben", () => {
        const sw1 = switchDevice("sw1", [vlan([{ id: 10, name: "Clients" }]),
        { id: "r", type: ProtocolType.Rstp, enabled: true, settings: { rootRole: "primary" } },
        { id: "e", type: ProtocolType.EtherChannel, enabled: false, settings: { lacpMode: "passive" } }], { 3: 10 });
        sw1.interfaces[0].portMode = "trunk";
        const { input, warnings } = switchingInputFromTopology(topology([sw1], []));
        const device = input.devices[0];
        assert.deepStrictEqual(device.protocols, [ProtocolType.Vlan, ProtocolType.Rstp]);
        assert.strictEqual(device.rootRole, "primary");
        assert.strictEqual(device.lacpMode, undefined, "deaktiviertes EtherChannel wird ignoriert");
        assert.strictEqual(device.interfaces[0].portMode, "trunk");
        assert.strictEqual(device.interfaces[2].accessVlan, 10);
        assert.strictEqual(device.interfaces[0].type, "fast-ethernet");
        assert.deepStrictEqual(input.vlans, [{ id: 10, name: "Clients" }]);
        assert.strictEqual(input.nativeVlan, 99);
        assert.deepStrictEqual(warnings, []);
    });

    test("führt VLAN-Listen zusammen und meldet Namens- und Native-VLAN-Konflikte", () => {
        const sw1 = switchDevice("sw1", [vlan([{ id: 10, name: "Clients" }])]);
        const sw2 = switchDevice("sw2", [vlan([{ id: 10, name: "Kunden" }, { id: 20, name: "Server" }], 88)]);
        const { input, warnings } = switchingInputFromTopology(topology([sw2, sw1], [["sw1-fa1", "sw2-fa1"]]));
        assert.deepStrictEqual(input.vlans, [{ id: 10, name: "Clients" }, { id: 20, name: "Server" }]);
        assert.strictEqual(input.nativeVlan, 99);
        assert.deepStrictEqual(warnings.map((w) => w.code), ["VLAN_NAME_CONFLICT", "NATIVE_VLAN_MISMATCH"]);
        assert.deepStrictEqual(input.connections[0].a, { deviceId: "sw1", interfaceId: "sw1-fa1" });
    });

    test("Ergebnis ist direkt für den Generator verwendbar", () => {
        const sw1 = switchDevice("sw1", [vlan([{ id: 10, name: "Clients" }])]);
        const sw2 = switchDevice("sw2", [vlan([{ id: 10, name: "Clients" }])]);
        const plan = planSwitching(switchingInputFromTopology(topology([sw1, sw2], [["sw1-fa1", "sw2-fa1"]])).input);
        assert.strictEqual(plan.switches[0].ports[0].role, "trunk");
        assert.strictEqual(plan.switches[0].ports[1].role, "unused");
    });
});
