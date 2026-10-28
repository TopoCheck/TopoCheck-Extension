import * as assert from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  DeviceType, OspfProtocol, StaticRouteProtocol, VlanProtocol, ProtocolType
} from "../../models";
import { parseCiscoConfig, parseCiscoTopology } from "../../parser";

function parse(text: string, deviceType = DeviceType.Router) {
  return parseCiscoConfig(text, { deviceId: "device-1", deviceType });
}

function fixture(name: string, deviceType: DeviceType) {
  // Fixtures remain in src; TypeScript does not copy non-code files into out.
  const text = readFileSync(resolve(__dirname, "../../../src/test/parser/fixtures", name), "utf8");
  const result = parse(text, deviceType);
  assert.deepStrictEqual(result.diagnostics, []);
  assert.ok(result.device);
  return result.device;
}

suite("Cisco IOS supported configurations", () => {
  test("assigns mixed interface and routing settings to their exact owners", () => {
    const result = parse([
      "hostname MixedRouter", "interface GigabitEthernet0/0", " description WAN",
      " ip address 192.0.2.1 255.255.255.0", " shutdown",
      "interface Loopback0", " description RouterIdentity",
      " ip address 10.0.0.1 255.255.255.255", " no shutdown",
      "router ospf 1", " router-id 10.0.0.1",
      " network 192.0.2.0 0.0.0.255 area 0", " passive-interface Loopback0",
      "router ospf 2", " router-id 10.0.0.2",
      " network 10.0.0.0 0.255.255.255 area 2", " passive-interface default",
      "ip route 0.0.0.0 0.0.0.0 192.0.2.254",
      "interface GigabitEthernet0/0", " description UpdatedWAN"
    ].join("\n"));
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.device);
    assert.deepStrictEqual(result.device.interfaces.map((item) => ({
      name: item.name, description: item.description, ip: item.ipAddress,
      mask: item.subnetMask, enabled: item.enabled
    })), [
      { name: "GigabitEthernet0/0", description: "UpdatedWAN", ip: "192.0.2.1", mask: "255.255.255.0", enabled: false },
      { name: "Loopback0", description: "RouterIdentity", ip: "10.0.0.1", mask: "255.255.255.255", enabled: true }
    ]);
    const ospf = result.device.protocols.find((item) => item instanceof OspfProtocol);
    const routes = result.device.protocols.find((item) => item instanceof StaticRouteProtocol);
    assert.ok(ospf instanceof OspfProtocol && routes instanceof StaticRouteProtocol);
    assert.strictEqual(result.device.protocols.length, 2);
    assert.deepStrictEqual(ospf.processes, [
      { processId: 1, routerId: "10.0.0.1", networks: [
        { address: "192.0.2.0", wildcardMask: "0.0.0.255", area: "0" }
      ], passiveInterfaceDefault: false, passiveInterfaces: { Loopback0: true } },
      { processId: 2, routerId: "10.0.0.2", networks: [
        { address: "10.0.0.0", wildcardMask: "0.255.255.255", area: "2" }
      ], passiveInterfaceDefault: true, passiveInterfaces: {} }
    ]);
    assert.deepStrictEqual(routes.routes, [
      { destination: "0.0.0.0", subnetMask: "0.0.0.0", nextHop: "192.0.2.254" }
    ]);
  });

  test("keeps access and trunk settings isolated between interfaces", () => {
    const result = parse([
      "hostname SW1", "interface FastEthernet0/1", " switchport mode access",
      " switchport access vlan 10", "interface GigabitEthernet0/1",
      " switchport mode trunk", " switchport trunk native vlan 99",
      " switchport trunk allowed vlan 10,20", "interface FastEthernet0/2",
      " switchport mode access", " switchport access vlan 20",
      "interface FastEthernet0/1", " no switchport"
    ].join("\n"), DeviceType.Switch);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.device);
    assert.deepStrictEqual(result.device.interfaces.map((item) => item.switchport), [
      undefined, { mode: "trunk", nativeVlan: 99, allowedVlans: [10, 20] },
      { mode: "access", accessVlan: 20 }
    ]);
  });

  test("parses basic router fixture", () => {
    const device = fixture("router-basic.cfg", DeviceType.Router);
    assert.strictEqual(device.hostname, "R1");
    assert.strictEqual(device.interfaces[0].description, "Uplink");
    assert.strictEqual(device.interfaces[0].ipAddress, "192.168.1.1");
    assert.strictEqual(device.interfaces[1].enabled, false);
  });

  test("parses VLAN definitions and access switchports", () => {
    const device = fixture("switch-vlan.cfg", DeviceType.Switch);
    const protocol = device.protocols[0];
    assert.ok(protocol instanceof VlanProtocol);
    assert.deepStrictEqual(protocol.vlans, [
      { vlanId: 10, name: "Clients" }, { vlanId: 20, name: "Servers" }
    ]);
    assert.deepStrictEqual(device.interfaces[0].switchport, { mode: "access", accessVlan: 10 });
  });

  test("parses trunk ranges and applies add/remove", () => {
    const device = fixture("switch-trunk.cfg", DeviceType.Switch);
    assert.deepStrictEqual(device.interfaces[0].switchport, {
      mode: "trunk", nativeVlan: 99, allowedVlans: [10, 20, 22, 30]
    });
  });

  test("parses next-hop, fully specified and discard static routes", () => {
    const device = fixture("router-static.cfg", DeviceType.Router);
    const protocol = device.protocols[0];
    assert.ok(protocol instanceof StaticRouteProtocol);
    assert.deepStrictEqual(protocol.routes, [
      { destination: "0.0.0.0", subnetMask: "0.0.0.0", nextHop: "192.0.2.254" },
      { destination: "10.0.0.0", subnetMask: "255.0.0.0", outgoingInterface: "GigabitEthernet0/0", nextHop: "192.0.2.2", administrativeDistance: 5 },
      { destination: "203.0.113.0", subnetMask: "255.255.255.0", outgoingInterface: "Null0", administrativeDistance: 250 }
    ]);
  });

  test("groups multiple OSPF processes into one H1c protocol", () => {
    const device = fixture("router-ospf.cfg", DeviceType.Router);
    const protocol = device.protocols[0];
    assert.ok(protocol instanceof OspfProtocol);
    assert.strictEqual(protocol.type, ProtocolType.Ospf);
    assert.strictEqual(device.protocols.length, 1);
    assert.deepStrictEqual(protocol.processes, [
      { processId: 1, routerId: "10.0.0.3", networks: [
        { address: "192.0.2.0", wildcardMask: "0.0.0.255", area: "0" }
      ], passiveInterfaceDefault: true, passiveInterfaces: { "GigabitEthernet0/0": false } },
      { processId: 2, networks: [
        { address: "10.0.0.0", wildcardMask: "0.255.255.255", area: "1" }
      ], passiveInterfaceDefault: false, passiveInterfaces: {} }
    ]);
  });

  test("reports malformed routing syntax and continues without invalid values", () => {
    const result = parse([
      "hostname R1", "ip route 10.0.0.1 255.0.0.0 192.0.2.1",
      "ip route 10.0.0.0 255.0.0.0 999.0.0.1", "router ospf 1",
      " router-id 999.0.0.1", " network 10.0.0.0 0.0.255.0 area 0",
      " network 10.0.0.0 0.255.255.255 area 4294967296",
      " router-id 10.0.0.1"
    ].join("\n"));
    assert.deepStrictEqual(result.diagnostics.map((d) => [d.line, d.severity]),
      [2, 3, 5, 6, 7].map((line) => [line, "error"]));
    const ospf = result.device?.protocols[0];
    assert.ok(ospf instanceof OspfProtocol);
    assert.strictEqual(ospf.processes[0].routerId, "10.0.0.1");
    assert.deepStrictEqual(ospf.processes[0].networks, []);
  });

  test("rejects incompatible protocols through diagnostics rather than model exceptions", () => {
    const result = parse("hostname SW1\nrouter ospf 1\n router-id 10.0.0.1\nip route 0.0.0.0 0.0.0.0 10.0.0.1", DeviceType.Switch);
    assert.strictEqual(result.device?.protocols.length, 0);
    assert.deepStrictEqual(result.diagnostics.map((d) => d.severity), ["error", "warning", "error"]);
    const router = parse("hostname R1\nvlan 10\n name LAN");
    assert.strictEqual(router.device?.protocols.length, 0);
    assert.strictEqual(router.diagnostics[0].severity, "error");
  });

  test("keeps valid switchport data on invalid ranges and supports none/all/except", () => {
    const result = parse([
      "hostname SW1", "interface GigabitEthernet0/1",
      " switchport trunk allowed vlan 10-12", " switchport trunk allowed vlan 20-10",
      " switchport access vlan 4095", " switchport trunk allowed vlan remove 11"
    ].join("\n"), DeviceType.Switch);
    assert.deepStrictEqual(result.diagnostics.map((d) => d.line), [4, 5]);
    assert.deepStrictEqual(result.device?.interfaces[0].switchport?.allowedVlans, [10, 12]);
    const special = parse([
      "hostname SW1", "interface GigabitEthernet0/1",
      " switchport trunk allowed vlan none", " switchport trunk allowed vlan add 10",
      "interface GigabitEthernet0/2", " switchport trunk allowed vlan all",
      "interface GigabitEthernet0/3", " switchport trunk allowed vlan except 10-12"
    ].join("\n"), DeviceType.Switch);
    assert.deepStrictEqual(special.diagnostics, []);
    assert.deepStrictEqual(special.device?.interfaces[0].switchport?.allowedVlans, [10]);
    assert.strictEqual(special.device?.interfaces[1].switchport?.allowedVlans, undefined);
    const except = special.device?.interfaces[2].switchport?.allowedVlans;
    assert.strictEqual(except?.length, 4091);
    assert.strictEqual(except?.includes(11), false);
  });

  test("reopens sections without duplicate protocols, VLANs or networks", () => {
    const result = parse([
      "hostname R1", "router ospf 1", " network 10.0.0.0 0.255.255.255 area 0",
      "!", "router ospf 1", " network 10.0.0.0 0.255.255.255 area 0.0.0.0",
      "interface Loopback0", " description Test", " ip address 10.0.0.1 255.255.255.255"
    ].join("\n"));
    assert.deepStrictEqual(result.diagnostics, []);
    const protocol = result.device?.protocols[0];
    assert.ok(protocol instanceof OspfProtocol);
    assert.strictEqual(protocol.processes.length, 1);
    assert.strictEqual(protocol.processes[0].networks.length, 1);
    const vlan = parse("hostname SW1\nvlan 10\n name Old\n!\nvlan 10\n name New", DeviceType.Switch);
    assert.deepStrictEqual((vlan.device?.protocols[0] as VlanProtocol).vlans, [{ vlanId: 10, name: "New" }]);
  });

  test("retains protocol-specific data in the H1c topology", () => {
    const result = parseCiscoTopology([{
      deviceId: "r1", deviceType: DeviceType.Router,
      text: "hostname R1\nrouter ospf 1\n router-id 10.0.0.1"
    }], { id: "actual", name: "Actual" });
    assert.deepStrictEqual(result.diagnostics, []);
    const protocol = result.topology?.findDevice("r1")?.protocols[0];
    assert.ok(protocol instanceof OspfProtocol);
    assert.strictEqual(protocol.processes[0].routerId, "10.0.0.1");
  });

  test("isolates invalid sections and preserves previous interface and VLAN values", () => {
    const result = parse([
      "hostname SW1", "interface GigabitEthernet0/1", " no shutdown",
      "vlan 0", " shutdown", "vlan 10", " name Clients",
      "vlan 4095", " name Invalid", "interface GigabitEthernet0/2",
      " switchport mode access", " switchport mode broken",
      " switchport access vlan x", " switchport trunk native vlan 0"
    ].join("\n"), DeviceType.Switch);
    assert.deepStrictEqual(result.diagnostics.map((d) => d.line), [4, 5, 8, 9, 12, 13, 14]);
    assert.strictEqual(result.device?.interfaces[0].enabled, true);
    assert.strictEqual(result.device?.interfaces[1].switchport?.mode, "access");
    assert.deepStrictEqual((result.device?.protocols[0] as VlanProtocol).vlans, [{ vlanId: 10, name: "Clients" }]);
  });

  test("reports unsupported OSPF commands and invalid process IDs without losing valid processes", () => {
    const result = parse([
      "hostname R1", "router ospf 0", " router-id 10.0.0.1",
      "router ospf 65536", "router ospf 1", " auto-cost reference-bandwidth 1000",
      " passive-interface Loopback0", " no passive-interface default",
      "ip route 10.0.0.0 255.0.0.0 192.0.2.1 999",
      "ip route 10.0.0.0 255.0.0.0 192.0.2.1",
      "ip route 10.0.0.0 255.0.0.0 192.0.2.1"
    ].join("\n"));
    assert.deepStrictEqual(result.diagnostics.map((d) => [d.line, d.severity]), [
      [2, "error"], [3, "warning"], [4, "error"], [6, "warning"], [9, "error"]
    ]);
    const ospf = result.device?.protocols.find((p) => p instanceof OspfProtocol) as OspfProtocol;
    assert.strictEqual(ospf.processes[0].passiveInterfaces.Loopback0, true);
    assert.strictEqual(ospf.processes[0].passiveInterfaceDefault, false);
    const routes = result.device?.protocols.find((p) => p instanceof StaticRouteProtocol) as StaticRouteProtocol;
    assert.strictEqual(routes.routes.length, 1);
  });
});
