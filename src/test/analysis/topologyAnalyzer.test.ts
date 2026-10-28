import * as assert from "assert";
import {
  analyzeTopology,
  TopologyIssueCode
} from "../../analysis/topologyAnalyzer";
import { DeviceType } from "../../models/deviceType";
import { InterfaceType } from "../../models/interfaceType";
import { NetworkConnection } from "../../models/networkConnection";
import { NetworkDevice } from "../../models/networkDevice";
import { NetworkInterface } from "../../models/networkInterface";
import { NetworkProtocol } from "../../models/networkProtocol";
import { NetworkTopology } from "../../models/networkTopology";
import { ProtocolType } from "../../models/protocolType";

suite("TopologyAnalyzer", () => {
  test("reports a device without an interface", () => {
    const topology = createTopology();
    topology.addDevice(createRouter("router-1", "Router1"));

    const issues = analyzeTopology(topology);

    assert.strictEqual(
      issues.some((issue) => issue.code === TopologyIssueCode.DeviceWithoutInterface),
      true
    );
  });

  test("reports an enabled interface without an IP configuration", () => {
    const topology = createTopology();
    const router = createRouter("router-1", "Router1");
    router.addInterface(createInterface("if-1", "GigabitEthernet0/0"));
    topology.addDevice(router);

    const issues = analyzeTopology(topology);
    const issue = issues.find((item) =>
      item.code === TopologyIssueCode.InterfaceWithoutIpConfiguration
    );

    assert.notStrictEqual(issue, undefined);
    assert.strictEqual(issue?.deviceId, "router-1");
    assert.strictEqual(issue?.interfaceId, "if-1");
  });

  test("reports a duplicate IP address", () => {
    const topology = createTopologyWithTwoRouters(
      "192.168.1.1",
      "192.168.1.1"
    );

    const issues = analyzeTopology(topology);
    const duplicateIssues = issues.filter((issue) =>
      issue.code === TopologyIssueCode.DuplicateIpAddress
    );

    assert.strictEqual(duplicateIssues.length, 1);
    assert.strictEqual(duplicateIssues[0].deviceId, "router-2");
    assert.strictEqual(duplicateIssues[0].interfaceId, "if-2");
  });

  test("reports a device without a connection", () => {
    const topology = createTopology();
    const router = createRouter("router-1", "Router1");
    router.addInterface(createInterface(
      "if-1",
      "GigabitEthernet0/0",
      "192.168.1.1"
    ));
    topology.addDevice(router);

    const issues = analyzeTopology(topology);

    assert.strictEqual(
      issues.some((issue) => issue.code === TopologyIssueCode.DeviceWithoutConnection),
      true
    );
  });

  test("returns no issues for a valid topology consumed by the analyzer", () => {
    const topology = createTopologyWithTwoRouters(
      "192.168.1.1",
      "192.168.1.2"
    );

    const router1 = topology.findDevice("router-1");
    const router2 = topology.findDevice("router-2");

    assert.notStrictEqual(router1, undefined);
    assert.notStrictEqual(router2, undefined);

    router1?.addProtocol(new NetworkProtocol({
      id: "ospf-router-1",
      type: ProtocolType.Ospf
    }));
    router2?.addProtocol(new NetworkProtocol({
      id: "ospf-router-2",
      type: ProtocolType.Ospf
    }));

    assert.deepStrictEqual(analyzeTopology(topology), []);
  });
});

function createTopology(): NetworkTopology {
  return new NetworkTopology({ id: "top-1", name: "Analyzer Lab" });
}

function createTopologyWithTwoRouters(
  firstIpAddress: string,
  secondIpAddress: string
): NetworkTopology {
  const topology = createTopology();
  const router1 = createRouter("router-1", "Router1");
  const router2 = createRouter("router-2", "Router2");

  router1.addInterface(createInterface(
    "if-1",
    "GigabitEthernet0/0",
    firstIpAddress
  ));
  router2.addInterface(createInterface(
    "if-2",
    "GigabitEthernet0/0",
    secondIpAddress
  ));

  topology.addDevice(router1);
  topology.addDevice(router2);
  topology.addConnection(new NetworkConnection({
    id: "connection-1",
    source: { deviceId: "router-1", interfaceId: "if-1" },
    target: { deviceId: "router-2", interfaceId: "if-2" }
  }));

  return topology;
}

function createRouter(id: string, hostname: string): NetworkDevice {
  return new NetworkDevice({ id, hostname, type: DeviceType.Router });
}

function createInterface(
  id: string,
  name: string,
  ipAddress?: string
): NetworkInterface {
  return new NetworkInterface({
    id,
    name,
    type: InterfaceType.GigabitEthernet,
    ipAddress,
    subnetMask: ipAddress === undefined ? undefined : "255.255.255.0"
  });
}
