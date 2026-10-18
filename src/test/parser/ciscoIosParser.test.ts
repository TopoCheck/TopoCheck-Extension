import * as assert from "assert";
import { DeviceType, NetworkDevice } from "../../models";
import { parseCiscoConfig } from "../../parser";

const options = { deviceId: "router-1", deviceType: DeviceType.Router };

suite("Cisco IOS parser", () => {
  test("maps separate interface blocks into the H1c model", () => {
    const result = parseCiscoConfig([
      "hostname R1", "interface GigabitEthernet0/0", " description Uplink",
      " ip address 192.168.1.1 255.255.255.0", " no shutdown", "!",
      "interface Loopback0", " ip address 10.0.0.1 255.255.255.255", " shutdown", "end"
    ].join("\r\n"), options);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.device instanceof NetworkDevice);
    assert.strictEqual(result.device.hostname, "R1");
    assert.strictEqual(result.device.interfaces.length, 2);
    const [uplink, loopback] = result.device.interfaces;
    assert.strictEqual(uplink.description, "Uplink");
    assert.strictEqual(uplink.ipAddress, "192.168.1.1");
    assert.strictEqual(uplink.subnetMask, "255.255.255.0");
    assert.strictEqual(uplink.enabled, true);
    assert.strictEqual(loopback.ipAddress, "10.0.0.1");
    assert.strictEqual(loopback.enabled, false);
  });

  test("reports invalid addresses and masks and continues", () => {
    const result = parseCiscoConfig([
      "hostname R1", "interface GigabitEthernet0/0",
      " ip address 999.1.1.1 255.255.255.0",
      " ip address 10.0.0.1 255.0.255.0",
      " ip address 10.0.0.1 255.255.255.0"
    ].join("\n"), options);
    assert.deepStrictEqual(result.diagnostics.map((d) => [d.line, d.severity]), [[3, "error"], [4, "error"]]);
    assert.strictEqual(result.device?.interfaces[0].ipAddress, "10.0.0.1");
  });

  test("isolates unsupported sections from the previous interface", () => {
    const result = parseCiscoConfig([
      "hostname R1", "interface Loopback0", " no shutdown",
      "router ospf 1", " shutdown", "interface Serial0/0", " ip address 10.0.0.1 255.0.0.0"
    ].join("\n"), options);
    assert.strictEqual(result.device?.interfaces[0].enabled, true);
    assert.strictEqual(result.device?.interfaces[0].ipAddress, undefined);
    assert.deepStrictEqual(result.diagnostics.map((d) => d.line), [4, 5, 6, 7]);
  });

  test("reopens interfaces and applies removal commands", () => {
    const result = parseCiscoConfig([
      "hostname R1", "interface Vlan10", " description LAN",
      " ip address 10.0.0.1 255.255.255.0", "exit", "interface Vlan10",
      " no ip address", " no description", " shutdown"
    ].join("\r"), { ...options, deviceType: DeviceType.Switch });
    assert.deepStrictEqual(result.diagnostics, []);
    assert.strictEqual(result.device?.interfaces.length, 1);
    assert.strictEqual(result.device.interfaces[0].ipAddress, undefined);
    assert.strictEqual(result.device.interfaces[0].description, undefined);
    assert.strictEqual(result.device.interfaces[0].enabled, false);
  });

  test("rejects missing identity and out-of-context commands", () => {
    assert.strictEqual(parseCiscoConfig("", options).device, undefined);
    assert.strictEqual(parseCiscoConfig("hostname R1", { ...options, deviceId: " " }).device, undefined);
    const result = parseCiscoConfig("hostname R1\n ip address 10.0.0.1 255.0.0.0", options);
    assert.deepStrictEqual(result.diagnostics.map((d) => [d.line, d.severity]), [[2, "error"]]);
  });

  test("preserves valid data on malformed commands and stops at end", () => {
    const result = parseCiscoConfig([
      "\uFEFFhostname R1", "interface Ethernet0/0", " ip address 10.0.0.1 255.0.0.0",
      " ip address dhcp", " description", " shutdown extra", "!",
      " shutdown", "end", "hostname Ignored"
    ].join("\n"), options);
    assert.strictEqual(result.device?.hostname, "R1");
    assert.strictEqual(result.device?.interfaces[0].ipAddress, "10.0.0.1");
    assert.deepStrictEqual(result.diagnostics.map((d) => d.line), [4, 5, 6, 8]);
  });
});
