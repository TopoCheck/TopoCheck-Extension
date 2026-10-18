import * as assert from "assert";
import { DeviceType } from "../../models";
import { parseCiscoConfig } from "../../parser";
import { CommandContext, expandCiscoCommand } from "../../parser/ciscoIosAbbreviations";

suite("Cisco IOS abbreviations", () => {
  const cases: [CommandContext, string, string][] = [
    ["global", "h R1", "hostname R1"],
    ["global", "in Gi0/0", "interface GigabitEthernet0/0"],
    ["global", "c t", "configure terminal"],
    ["global", "en", "end"], ["global", "ex", "exit"],
    ["global", "v 10", "vlan 10"],
    ["vlan", "na Clients", "name Clients"],
    ["interface", "d Keep  My CASE", "description Keep  My CASE"],
    ["interface", "sh", "shutdown"], ["interface", "no sh", "no shutdown"],
    ["interface", "ip a 10.0.0.1 255.0.0.0", "ip address 10.0.0.1 255.0.0.0"],
    ["interface", "no ip a", "no ip address"],
    ["interface", "no d", "no description"],
    ["interface", "sw mo a", "switchport mode access"],
    ["interface", "sw mo t", "switchport mode trunk"],
    ["interface", "sw a v 10", "switchport access vlan 10"],
    ["interface", "sw t n v 99", "switchport trunk native vlan 99"],
    ["interface", "sw t a v ad 10", "switchport trunk allowed vlan add 10"],
    ["interface", "sw t a v r 10", "switchport trunk allowed vlan remove 10"],
    ["interface", "sw t a v e 10", "switchport trunk allowed vlan except 10"],
    ["interface", "sw t a v al", "switchport trunk allowed vlan all"],
    ["interface", "sw t a v n", "switchport trunk allowed vlan none"],
    ["interface", "no sw", "no switchport"],
    ["global", "r o 1", "router ospf 1"],
    ["ospf", "router-i 10.0.0.1", "router-id 10.0.0.1"],
    ["ospf", "net 10.0.0.0 0.255.255.255 a 0", "network 10.0.0.0 0.255.255.255 area 0"],
    ["ospf", "p d", "passive-interface default"],
    ["ospf", "no p gi0/0", "no passive-interface GigabitEthernet0/0"],
    ["global", "ip r 0.0.0.0 0.0.0.0 Gi0/0 10.0.0.1 5", "ip route 0.0.0.0 0.0.0.0 GigabitEthernet0/0 10.0.0.1 5"],
    ["global", "b motd #Keep  CASE#", "banner motd #Keep  CASE#"]
  ];
  for (const [context, input, expected] of cases) {
    test(`expands ${input} in ${context} context`, () => {
      assert.deepStrictEqual(expandCiscoCommand(input, context), { command: expected });
    });
  }

  test("produces identical model data for full and abbreviated router configurations", () => {
    const full = "hostname R1\ninterface GigabitEthernet0/0\n description Uplink\n ip address 192.0.2.1 255.255.255.0\n no shutdown\n!\nrouter ospf 1\n router-id 10.0.0.1\n network 192.0.2.0 0.0.0.255 area 0\n passive-interface default\n no passive-interface GigabitEthernet0/0\n!\nip route 0.0.0.0 0.0.0.0 192.0.2.254\nend";
    const short = "H R1\nINT gi0/0\n desc Uplink\n ip add 192.0.2.1 255.255.255.0\n no shut\n!\nrou os 1\n router-i 10.0.0.1\n net 192.0.2.0 0.0.0.255 ar 0\n pass def\n no pass gi0/0\n!\nip rou 0.0.0.0 0.0.0.0 192.0.2.254\nen";
    const options = { deviceId: "r1", deviceType: DeviceType.Router };
    assert.deepStrictEqual(parseCiscoConfig(short, options), parseCiscoConfig(full, options));
  });

  test("produces identical model data for abbreviated switch configurations", () => {
    const options = { deviceId: "sw1", deviceType: DeviceType.Switch };
    const full = "hostname SW1\nvlan 10\n name Clients\n!\ninterface FastEthernet0/1\n switchport mode access\n switchport access vlan 10\n!\ninterface GigabitEthernet0/1\n switchport mode trunk\n switchport trunk native vlan 99\n switchport trunk allowed vlan 10,20-22\n switchport trunk allowed vlan remove 21";
    const short = "host SW1\nvl 10\n na Clients\n!\nin fa0/1\n sw mo acc\n sw acc vl 10\n!\nin gi0/1\n sw mo tr\n sw tr nat vl 99\n sw tr all vl 10,20-22\n sw tr all vl rem 21";
    assert.deepStrictEqual(parseCiscoConfig(short, options), parseCiscoConfig(full, options));
  });

  test("reports ambiguity with original source and continues without changing values", () => {
    const result = parseCiscoConfig("hostname R1\ninterface Gi0/0\n switchport trunk allowed vlan a\n description Recovered",
      { deviceId: "sw1", deviceType: DeviceType.Switch });
    assert.strictEqual(result.diagnostics.length, 1);
    assert.strictEqual(result.diagnostics[0].line, 3);
    assert.strictEqual(result.diagnostics[0].command, "switchport trunk allowed vlan a");
    assert.match(result.diagnostics[0].message, /add, all/);
    assert.strictEqual(result.device?.interfaces[0].description, "Recovered");
  });

  test("canonicalizes repeated interface aliases and preserves invalid names", () => {
    const result = parseCiscoConfig("hostname R1\nint Fa0/0\n desc First\nint FastEthernet0/0\n shutdown\nint fa0/w",
      { deviceId: "r1", deviceType: DeviceType.Router });
    assert.strictEqual(result.device?.interfaces.length, 1);
    assert.strictEqual(result.device.interfaces[0].description, "First");
    assert.strictEqual(result.device.interfaces[0].enabled, false);
    assert.strictEqual(result.diagnostics[0].line, 6);
  });

  test("rejects ambiguous root prefixes and leaves banner bodies untouched", () => {
    assert.match(expandCiscoCommand("i Gi0/0", "global").error ?? "", /interface, ip/);
    assert.match(expandCiscoCommand("e", "global").error ?? "", /end, exit/);
    const result = parseCiscoConfig("host R1\nb motd #\nh Hidden\nen\n#\nin Lo0\n no sh",
      { deviceId: "r1", deviceType: DeviceType.Router });
    assert.strictEqual(result.device?.hostname, "R1");
    assert.strictEqual(result.device?.interfaces[0].name, "Loopback0");
    assert.strictEqual(result.diagnostics.length, 1);
  });
});
