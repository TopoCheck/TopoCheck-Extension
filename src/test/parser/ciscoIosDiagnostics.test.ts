import * as assert from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";
import { DeviceType, OspfProtocol, StaticRouteProtocol } from "../../models";
import { CiscoIosParserOptions, parseCiscoConfig } from "../../parser";

const options = { deviceId: "r1", deviceType: DeviceType.Router };
function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../src/test/parser/fixtures", name), "utf8");
}

suite("Cisco IOS diagnostics and recovery", () => {
  test("reports exact lines and source commands while preserving valid values", () => {
    const text = fixture("invalid-values.cfg");
    const result = parseCiscoConfig(text, options);
    assert.deepStrictEqual(result.diagnostics.map((d) => [d.line, d.severity]),
      [4, 5, 6, 7, 13, 14, 17].map((line) => [line, "error"]));
    for (const diagnostic of result.diagnostics) {
      assert.ok(diagnostic.message.length > 10);
      assert.strictEqual(diagnostic.command, text.split(/\r?\n/)[diagnostic.line - 1].trim());
    }
    const networkInterface = result.device?.interfaces[0];
    assert.strictEqual(networkInterface?.ipAddress, "192.0.2.1");
    assert.strictEqual(networkInterface?.subnetMask, "255.255.255.0");
    assert.strictEqual(networkInterface?.description, "Recovered");
    assert.strictEqual(networkInterface?.enabled, true);
    const ospf = result.device?.protocols.find((p) => p instanceof OspfProtocol) as OspfProtocol;
    assert.strictEqual(ospf.processes[0].routerId, "10.0.0.1");
    assert.strictEqual(ospf.processes[0].networks.length, 1);
    const routes = result.device?.protocols.find((p) => p instanceof StaticRouteProtocol) as StaticRouteProtocol;
    assert.strictEqual(routes.routes.length, 1);
    assert.strictEqual(routes.routes[0].destination, "0.0.0.0");
  });

  test("reports unknown syntax and skips banner text without executing it", () => {
    const result = parseCiscoConfig(fixture("unknown-syntax.cfg"), options);
    assert.deepStrictEqual(result.diagnostics.map((d) => [d.line, d.severity]),
      [2, 4, 9, 12].map((line) => [line, "warning"]));
    assert.strictEqual(result.device?.hostname, "WarningRouter");
    assert.strictEqual(result.device?.interfaces[0].description, "StillParsed");
    assert.strictEqual(result.device?.interfaces[1].ipAddress, "10.0.0.1");
  });

  test("reports empty inputs and malformed runtime arguments without throwing", () => {
    for (const text of ["", " \r\n\t", "\uFEFF"]) {
      const result = parseCiscoConfig(text, options);
      assert.strictEqual(result.device, undefined);
      assert.strictEqual(result.diagnostics.length, 1);
      assert.match(result.diagnostics[0].message, /leer/);
    }
    // JavaScript callers and deserialized values may violate TypeScript contracts.
    for (const value of [undefined, null, 42, {}]) {
      const result = parseCiscoConfig(value as unknown as string, options);
      assert.strictEqual(result.device, undefined);
      assert.strictEqual(result.diagnostics[0].severity, "error");
    }
    for (const value of [undefined, null, {}, { deviceId: 42 },
      { deviceId: "r1", deviceType: "unknown" }]) {
      const result = parseCiscoConfig("hostname R1", value as unknown as CiscoIosParserOptions);
      assert.strictEqual(result.device, undefined);
      assert.strictEqual(result.diagnostics[0].severity, "error");
    }
  });

  test("recovers from invalid headers without assigning children to the previous section", () => {
    const result = parseCiscoConfig([
      "hostname R1", "interface Loopback0", " description Original", "interface",
      " description MustNotApply", "interface Loopback1", " description Recovered",
      "hostname invalid name", "interface Loopback2", " shutdown"
    ].join("\n"), options);
    assert.deepStrictEqual(result.diagnostics.map((d) => [d.line, d.severity]),
      [[4, "error"], [5, "warning"], [8, "error"]]);
    assert.strictEqual(result.device?.hostname, "R1");
    assert.strictEqual(result.device?.interfaces[0].description, "Original");
    assert.strictEqual(result.device?.interfaces[1].description, "Recovered");
    assert.strictEqual(result.device?.interfaces[2].enabled, false);
  });

  test("reports supported child commands outside their required context", () => {
    const result = parseCiscoConfig([
      "hostname R1", " router-id 10.0.0.1", " network 10.0.0.0 0.255.255.255 area 0",
      " name LAN", " ip address 10.0.0.1 255.0.0.0", "interface Loopback0", " no\tshutdown"
    ].join("\n"), options);
    assert.deepStrictEqual(result.diagnostics.map((d) => [d.line, d.severity]),
      [2, 3, 4, 5].map((line) => [line, "error"]));
    assert.strictEqual(result.device?.interfaces[0].enabled, true);
  });

  test("reports unterminated banners at the opening line and supports inline banners", () => {
    const broken = parseCiscoConfig("hostname R1\nbanner motd #\nhostname Hidden", options);
    assert.strictEqual(broken.device?.hostname, "R1");
    assert.deepStrictEqual(broken.diagnostics.map((d) => [d.line, d.severity]),
      [[2, "warning"], [2, "error"]]);
    const inline = parseCiscoConfig("hostname R1\nbanner motd #Notice#\ninterface Loopback0", options);
    assert.strictEqual(inline.diagnostics.length, 1);
    assert.strictEqual(inline.device?.interfaces.length, 1);
  });

  test("isolates repeated calls and handles malformed command combinations without throwing", () => {
    const commands = ["hostname", "interface", "vlan -1", "router ospf x", "ip route",
      " network", " router-id", " switchport trunk allowed vlan ,", " ip address", "exit", "!",
      "banner", " no shutdown extra", "unknown", "interface Loopback0"];
    for (let offset = 0; offset < commands.length; offset++) {
      const result = parseCiscoConfig([
        "hostname R1", ...commands.slice(offset), ...commands.slice(0, offset),
        "!", "interface Loopback99", " description RecoveryMarker"
      ].join("\n"), options);
      assert.ok(result.diagnostics.length > 0);
      assert.strictEqual(result.device?.interfaces.find((i) => i.name === "Loopback99")?.description,
        "RecoveryMarker");
    }
    const clean = parseCiscoConfig("hostname R2\ninterface Loopback0", options);
    assert.deepStrictEqual(clean.diagnostics, []);
    assert.strictEqual(clean.device?.hostname, "R2");
  });
});
