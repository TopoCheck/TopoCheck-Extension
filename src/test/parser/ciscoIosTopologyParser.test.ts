import * as assert from "assert";
import { analyzeTopology, TopologyIssueCode } from "../../analysis/topologyAnalyzer";
import { DeviceType, NetworkConnection, NetworkTopology } from "../../models";
import { parseCiscoTopology } from "../../parser";

const metadata = { id: "actual", name: "Parsed configurations" };

function configuration(deviceId: string, hostname: string, ip = "10.0.0.1") {
  return {
    deviceId, deviceType: DeviceType.Router,
    text: `hostname ${hostname}\ninterface GigabitEthernet0/0\n ip address ${ip} 255.255.255.0`
  };
}

suite("Cisco IOS topology model integration", () => {
  test("feeds parsed H1c objects directly into connections and analysis", () => {
    const result = parseCiscoTopology([
      configuration("r1", "R1"), configuration("r2", "R2")
    ], metadata);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.topology instanceof NetworkTopology);
    result.topology.addConnection(new NetworkConnection({
      id: "link-1",
      source: { deviceId: "r1", interfaceId: "r1:GigabitEthernet0/0" },
      target: { deviceId: "r2", interfaceId: "r2:GigabitEthernet0/0" }
    }));
    const issues = analyzeTopology(result.topology);
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].code, TopologyIssueCode.DuplicateIpAddress);
    assert.strictEqual(issues[0].deviceId, "r2");
  });

  test("keeps identity stable across hostname and address changes for later comparison", () => {
    const planned = parseCiscoTopology([configuration("r1", "Planned", "10.0.0.1")], metadata);
    const actual = parseCiscoTopology([configuration("r1", "Actual", "10.0.0.2")], metadata);
    const plannedDevice = planned.topology?.findDevice("r1");
    const actualDevice = actual.topology?.findDevice("r1");
    assert.ok(plannedDevice && actualDevice);
    assert.strictEqual(actualDevice.interfaces[0].id, plannedDevice.interfaces[0].id);
    assert.notStrictEqual(actualDevice.hostname, plannedDevice.hostname);
    assert.notStrictEqual(actualDevice.interfaces[0].ipAddress, plannedDevice.interfaces[0].ipAddress);
    actualDevice.interfaces[0].disable();
    assert.strictEqual(plannedDevice.interfaces[0].enabled, true);
  });

  test("returns no partial topology on invalid configuration or duplicate IDs", () => {
    const invalid = parseCiscoTopology([
      configuration("r1", "R1"), configuration("r2", "R2", "999.0.0.1")
    ], metadata);
    assert.strictEqual(invalid.topology, undefined);
    assert.deepStrictEqual(invalid.diagnostics.map((d) => [d.deviceId, d.line]), [["r2", 3]]);
    const duplicate = parseCiscoTopology([
      configuration("r1", "R1"), configuration(" r1 ", "R2")
    ], metadata);
    assert.strictEqual(duplicate.topology, undefined);
    assert.ok(duplicate.diagnostics.some((d) => d.message.includes("Duplicate device ID")));
  });

  test("retains warnings and leaves physical connections to the caller", () => {
    const input = configuration("r1", "R1");
    input.text += "\nrouter bgp 65001";
    const result = parseCiscoTopology([input], metadata);
    assert.ok(result.topology);
    assert.strictEqual(result.topology.connections.length, 0);
    assert.strictEqual(result.diagnostics[0].severity, "warning");
    assert.strictEqual(result.diagnostics[0].deviceId, "r1");
  });
});
