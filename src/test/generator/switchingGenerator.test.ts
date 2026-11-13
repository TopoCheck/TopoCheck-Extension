import * as assert from "assert";
import { DeviceType } from "../../models/deviceType";
import { InterfaceType } from "../../models/interfaceType";
import { ProtocolType } from "../../models/protocolType";
import {
  planSwitching,
  SwitchingDeviceInput,
  SwitchingTopologyInput,
  SwitchPlan
} from "../../generator/switching";
import type { NetworkInterface } from "../../models/networkInterface";
import { parseCiscoConfig } from "../../parser";


// Testtopologie (Demo-Szenario)

const SWITCH_PROTOCOLS = [ProtocolType.Vlan, ProtocolType.Rstp, ProtocolType.EtherChannel];

function switchDevice(id: string, access: Record<string, number> = {}, protocols = SWITCH_PROTOCOLS): SwitchingDeviceInput {
    return {
        id,
        hostname: id.toUpperCase(),
        type: DeviceType.Switch,
        protocols,
        interfaces: Array.from({ length: 8 }, (_, i) => {
            const name = `FastEthernet0/${i + 1}`;
            return { id: `${id}-fa${i + 1}`, name, type: InterfaceType.FastEthernet, accessVlan: access[name] };
        })
    };
}

function link(id: string, a: string, aPort: number, b: string, bPort: number) {
    const ifId = (dev: string, port: number) => dev.startsWith("sw") ? `${dev}-fa${port}` : `${dev}-if${port}`;
    return { id, a: { deviceId: a, interfaceId: ifId(a, aPort) }, b: { deviceId: b, interfaceId: ifId(b, bPort) } };
}

function demoTopology(): SwitchingTopologyInput {
    return {
        vlans: [{ id: 10, name: "Clients" }, { id: 20, name: "Server" }],
        devices: [
            {
                id: "r1", hostname: "R1", type: DeviceType.Router, protocols: [],
                interfaces: [{ id: "r1-if0", name: "GigabitEthernet0/0", type: InterfaceType.GigabitEthernet, subinterfaceVlans: [10, 20] }]
            },
            switchDevice("sw1"),
            switchDevice("sw2", { "FastEthernet0/5": 10 }),
            switchDevice("sw3", { "FastEthernet0/6": 20 }),
            { id: "pc1", hostname: "PC1", type: DeviceType.Pc, protocols: [], interfaces: [{ id: "pc1-if0", name: "eth0", type: InterfaceType.Ethernet }] },
            { id: "pc2", hostname: "PC2", type: DeviceType.Pc, protocols: [], interfaces: [{ id: "pc2-if0", name: "eth0", type: InterfaceType.Ethernet }] }
        ],
        connections: [
            link("c1", "r1", 0, "sw1", 1),
            link("c2", "sw1", 2, "sw2", 2),
            link("c3", "sw1", 3, "sw2", 3),
            link("c4", "sw1", 4, "sw3", 4),
            link("c5", "sw2", 4, "sw3", 5),
            link("c6", "sw2", 5, "pc1", 0),
            link("c7", "sw3", 6, "pc2", 0)
        ]
    };
}

function sw(plan: { switches: SwitchPlan[] }, hostname: string): SwitchPlan {
    const found = plan.switches.find((item) => item.hostname === hostname);
    assert.ok(found, `Switch ${hostname} fehlt im Plan`);
    return found;
}

function port(plan: SwitchPlan, name: string) {
    const found = plan.ports.find((item) => item.name === name);
    assert.ok(found, `Port ${name} fehlt auf ${plan.hostname}`);
    return found;
}

suite("H3b Switching-Generator – VLANs", () => {
    test("legt Benutzer-VLANs, Native VLAN und Blackhole-VLAN auf jedem Switch an", () => {
        const plan = planSwitching(demoTopology());
        for (const hostname of ["SW1", "SW2", "SW3"]) {
            assert.deepStrictEqual(sw(plan, hostname).vlans, [
                { vlanId: 10, name: "Clients" },
                { vlanId: 20, name: "Server" },
                { vlanId: 99, name: "NATIVE" },
                { vlanId: 999, name: "BLACKHOLE" }
            ]);
        }
    });

    test("ignoriert ungültige, reservierte und doppelte VLANs mit Warnung", () => {
        const input = demoTopology();
        input.vlans.push({ id: 1003, name: "x" }, { id: 5000, name: "x" }, { id: 10, name: "Dup" }, { id: 30, name: "Guest WLAN" });
        const plan = planSwitching(input);
        const codes = plan.warnings.map((w) => w.code);
        assert.ok(codes.includes("VLAN_RESERVED"));
        assert.ok(codes.includes("VLAN_INVALID"));
        assert.ok(codes.includes("VLAN_DUPLICATE"));
        assert.ok(codes.includes("VLAN_NAME_ADJUSTED"));
        assert.deepStrictEqual(sw(plan, "SW1").vlans.map((v) => v.vlanId), [10, 20, 30, 99, 999]);
        assert.strictEqual(sw(plan, "SW1").vlans.find((v) => v.vlanId === 30)?.name, "Guest_WLAN");
    });
});

suite("H3b Switching-Generator – Access- und Trunk-Ports", () => {
    test("Port zum PC wird Access-Port im zugewiesenen VLAN mit PortFast und BPDU Guard", () => {
        const p = port(sw(planSwitching(demoTopology()), "SW2"), "FastEthernet0/5");
        assert.strictEqual(p.role, "access");
        assert.deepStrictEqual(p.switchport, { mode: "access", accessVlan: 10 });
        assert.strictEqual(p.portfast, true);
        assert.strictEqual(p.bpduGuard, true);
        assert.strictEqual(p.shutdown, false);
    });

    test("Switch-Switch-Link wird Trunk mit Native VLAN 99, expliziter Allowed-Liste und ohne DTP", () => {
        const p = port(sw(planSwitching(demoTopology()), "SW1"), "FastEthernet0/4");
        assert.strictEqual(p.role, "trunk");
        assert.deepStrictEqual(p.switchport, { mode: "trunk", nativeVlan: 99, allowedVlans: [10, 20, 99] });
        assert.strictEqual(p.nonegotiate, true);
        assert.strictEqual(p.portfast, false);
    });

    test("Router mit Subinterfaces (Router-on-a-Stick) → Trunk nur mit dessen VLANs", () => {
        const input = demoTopology();
        input.devices[0].interfaces[0].subinterfaceVlans = [10];
        const p = port(sw(planSwitching(input), "SW1"), "FastEthernet0/1");
        assert.strictEqual(p.role, "trunk");
        assert.deepStrictEqual(p.switchport?.allowedVlans, [10, 99]);
    });

    test("Router ohne Subinterfaces → Access-Port", () => {
        const input = demoTopology();
        input.devices[0].interfaces[0].subinterfaceVlans = undefined;
        input.devices[1].interfaces[0].accessVlan = 20;
        const p = port(sw(planSwitching(input), "SW1"), "FastEthernet0/1");
        assert.strictEqual(p.role, "access");
        assert.deepStrictEqual(p.switchport, { mode: "access", accessVlan: 20 });
        assert.strictEqual(p.portfast, false, "PortFast nur Richtung Endgeräte");
    });

    test("ungenutzte Ports werden abgeschaltet und ins Blackhole-VLAN gelegt", () => {
        const p = port(sw(planSwitching(demoTopology()), "SW1"), "FastEthernet0/8");
        assert.strictEqual(p.role, "unused");
        assert.strictEqual(p.shutdown, true);
        assert.deepStrictEqual(p.switchport, { mode: "access", accessVlan: 999 });
    });

    test("Benutzer kann den Port-Modus überschreiben – mit Warnung bei untypischer Wahl", () => {
        const input = demoTopology();
        input.devices[2].interfaces[4].portMode = "trunk"; // SW2 Fa0/5 → PC1
        const plan = planSwitching(input);
        assert.strictEqual(port(sw(plan, "SW2"), "FastEthernet0/5").role, "trunk");
        assert.ok(plan.warnings.some((w) => w.code === "TRUNK_TO_END_DEVICE"));
    });

    test("fehlendes oder unbekanntes Access-VLAN erzeugt Warnung, Port bleibt in VLAN 1", () => {
        const input = demoTopology();
        input.devices[2].interfaces[4].accessVlan = undefined;
        input.devices[3].interfaces[5].accessVlan = 77;
        const plan = planSwitching(input);
        assert.deepStrictEqual(port(sw(plan, "SW2"), "FastEthernet0/5").switchport, { mode: "access" });
        assert.deepStrictEqual(port(sw(plan, "SW3"), "FastEthernet0/6").switchport, { mode: "access" });
        const codes = plan.warnings.map((w) => w.code);
        assert.ok(codes.includes("ACCESS_VLAN_MISSING"));
        assert.ok(codes.includes("ACCESS_VLAN_UNKNOWN"));
    });
});

suite("H3b Switching-Generator – EtherChannel", () => {
    test("zwei parallele Links SW1–SW2 werden zu Port-channel1 (LACP) auf beiden Seiten", () => {
        const plan = planSwitching(demoTopology());
        for (const [hostname, peer] of [["SW1", "SW2"], ["SW2", "SW1"]]) {
            const s = sw(plan, hostname);
            assert.strictEqual(s.portChannels.length, 1);
            const channel = s.portChannels[0];
            assert.strictEqual(channel.number, 1);
            assert.strictEqual(channel.peerHostname, peer);
            assert.strictEqual(channel.lacpMode, "active");
            assert.deepStrictEqual(channel.switchport, { mode: "trunk", nativeVlan: 99, allowedVlans: [10, 20, 99] });
            for (const name of ["FastEthernet0/2", "FastEthernet0/3"]) {
                assert.strictEqual(port(s, name).role, "channel-member");
                assert.strictEqual(port(s, name).channelGroup, 1);
            }
        }
    });

    test("einzelner Link erzeugt keinen EtherChannel", () => {
        const plan = planSwitching(demoTopology());
        assert.strictEqual(sw(plan, "SW3").portChannels.length, 0);
        assert.strictEqual(port(sw(plan, "SW1"), "FastEthernet0/4").role, "trunk");
    });

    test("kein EtherChannel, wenn er nur auf einer Seite aktiviert ist", () => {
        const input = demoTopology();
        input.devices[2].protocols = [ProtocolType.Vlan, ProtocolType.Rstp];
        const plan = planSwitching(input);
        assert.strictEqual(sw(plan, "SW1").portChannels.length, 0);
        assert.ok(plan.warnings.some((w) => w.code === "ETHERCHANNEL_DISABLED_ON_PEER"));
    });

    test("kein EtherChannel bei unterschiedlichen Interface-Typen", () => {
        const input = demoTopology();
        input.devices[1].interfaces[2] = { ...input.devices[1].interfaces[2], name: "GigabitEthernet0/1", type: InterfaceType.GigabitEthernet };
        const plan = planSwitching(input);
        assert.strictEqual(sw(plan, "SW1").portChannels.length, 0);
        assert.ok(plan.warnings.some((w) => w.code === "ETHERCHANNEL_TYPE_MISMATCH"));
    });
});

suite("H3b Switching-Generator – STP/RSTP", () => {
    test("RSTP aktiv → rapid-pvst auf allen Switches", () => {
        const plan = planSwitching(demoTopology());
        assert.ok(plan.switches.every((s) => s.stp.mode === "rapid-pvst"));
    });

    test("Switch am Router wird Primary Root, nächstbester Secondary Root", () => {
        const plan = planSwitching(demoTopology());
        assert.deepStrictEqual(sw(plan, "SW1").stp, { mode: "rapid-pvst", rootRole: "primary", priority: 4096, vlans: [1, 10, 20, 99] });
        assert.strictEqual(sw(plan, "SW2").stp.rootRole, "secondary");
        assert.strictEqual(sw(plan, "SW2").stp.priority, 8192);
        assert.strictEqual(sw(plan, "SW3").stp.rootRole, "none");
        assert.strictEqual(sw(plan, "SW3").stp.priority, undefined);
    });

    test("ohne Router: Switch mit den meisten Switch-Nachbarn wird Root", () => {
        const input = demoTopology();
        input.connections = input.connections.filter((c) => c.id !== "c1" && c.id !== "c5"); // SW1 bleibt zentral
        const plan = planSwitching(input);
        assert.strictEqual(sw(plan, "SW1").stp.rootRole, "primary");
    });

    test("klassisches STP gewählt → pvst; nichts gewählt → RSTP mit Hinweis", () => {
        const input = demoTopology();
        input.devices[1].protocols = [ProtocolType.Vlan, ProtocolType.Stp, ProtocolType.EtherChannel];
        input.devices[3].protocols = [ProtocolType.Vlan];
        const plan = planSwitching(input);
        assert.strictEqual(sw(plan, "SW1").stp.mode, "pvst");
        assert.strictEqual(sw(plan, "SW3").stp.mode, "rapid-pvst");
        const codes = plan.warnings.map((w) => w.code);
        assert.ok(codes.includes("STP_DEFAULTED"));
        assert.ok(codes.includes("STP_MODE_MIXED"));
    });
});

suite("H3b Switching-Generator – Cisco-IOS-Ausgabe", () => {
    test("formatVlanList fasst Bereiche wie IOS zusammen", () => {
        assert.strictEqual(formatVlanList([99, 10, 20, 21, 22]), "10,20-22,99");
        assert.strictEqual(formatVlanList([10, 11]), "10,11");
        assert.strictEqual(formatVlanList([1]), "1");
    });

    test("erzeugt die erwarteten IOS-Befehle", () => {
        const text = renderSwitchIos(sw(planSwitching(demoTopology()), "SW1"));
        for (const expected of [
            "vlan 10\n name Clients\n exit",
            "spanning-tree mode rapid-pvst",
            "spanning-tree vlan 1,10,20,99 priority 4096",
            "interface FastEthernet0/2\n description Po1 member - Link to SW2 FastEthernet0/2\n switchport mode trunk\n" +
            " switchport trunk native vlan 99\n switchport trunk allowed vlan 10,20,99\n switchport nonegotiate\n" +
            " channel-group 1 mode active\n no shutdown",
            "interface Port-channel1\n description EtherChannel (LACP) to SW2\n switchport mode trunk",
            "interface FastEthernet0/8\n description UNUSED\n switchport mode access\n switchport access vlan 999\n shutdown"
        ]) {
            assert.ok(text.includes(expected), `Erwartet:\n${expected}\n\nErhalten:\n${text}`);
        }
    });

    test("Ausgabe ist deterministisch", () => {
        const first = generateSwitchingConfigurations(demoTopology());
        const second = generateSwitchingConfigurations(demoTopology());
        assert.deepStrictEqual(first, second);
    });

    test("Round-Trip: der TopoCheck-Parser liest VLANs und Switchports der erzeugten Konfiguration identisch ein", () => {
        const plan = sw(planSwitching(demoTopology()), "SW2");
        const result = parseCiscoConfig(`hostname SW2\n${renderSwitchIos(plan)}`, { deviceId: "sw2", deviceType: DeviceType.Switch });
        assert.ok(result.device);
        assert.deepStrictEqual(result.diagnostics.filter((d) => d.severity === "error"), []);
        for (const planned of plan.ports) {
            const parsed: NetworkInterface | undefined = result.device.interfaces.find((i) => i.name === planned.name);
            assert.ok(parsed, `${planned.name} nicht geparst`);
            assert.deepStrictEqual(parsed.switchport, planned.switchport, planned.name);
            assert.strictEqual(parsed.enabled, !planned.shutdown, planned.name);
        }
    });
});
