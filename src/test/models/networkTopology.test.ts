import * as assert from "assert";
import { DeviceType } from "../../models/deviceType";
import { InterfaceType } from "../../models/interfaceType";
import { NetworkConnection } from "../../models/networkConnection";
import { NetworkDevice } from "../../models/networkDevice";
import { NetworkInterface } from "../../models/networkInterface";
import { NetworkTopology } from "../../models/networkTopology";

suite("NetworkTopology", () => {
  test("creates a topology and trims its identity fields", () => {
    const topology = new NetworkTopology({ id: " top-1 ", name: " Lab " });

    assert.strictEqual(topology.id, "top-1");
    assert.strictEqual(topology.name, "Lab");
  });

  test("rejects an empty ID or name", () => {
    assert.throws(
      () => new NetworkTopology({ id: " ", name: "Lab" }),
      /Topology ID must not be empty/
    );
    assert.throws(
      () => new NetworkTopology({ id: "top-1", name: " " }),
      /Topology name must not be empty/
    );
  });

  test("adds, finds and removes a device", () => {
    const topology = createTopology();
    const device = createDevice("router-1", "Router1", "if-1");

    topology.addDevice(device);
    assert.strictEqual(topology.findDevice("router-1"), device);
    assert.strictEqual(topology.devices.length, 1);

    assert.strictEqual(topology.removeDevice("router-1"), true);
    assert.strictEqual(topology.findDevice("router-1"), undefined);
    assert.strictEqual(topology.removeDevice("unknown"), false);
  });

  test("rejects duplicate device IDs", () => {
    const topology = createTopology();
    topology.addDevice(createDevice("router-1", "Router1", "if-1"));

    assert.throws(
      () => topology.addDevice(createDevice("router-1", "Router2", "if-2")),
      /Device with ID "router-1" already exists/
    );
  });

  test("adds, finds and removes a valid connection", () => {
    const topology = createConnectedTopology();

    assert.strictEqual(topology.connections.length, 1);
    assert.strictEqual(topology.findConnection("connection-1")?.id, "connection-1");
    assert.strictEqual(topology.removeConnection("connection-1"), true);
    assert.strictEqual(topology.findConnection("connection-1"), undefined);
    assert.strictEqual(topology.removeConnection("unknown"), false);
  });

  test("rejects duplicate connection IDs", () => {
    const topology = createConnectedTopology();

    assert.throws(() => topology.addConnection(new NetworkConnection({
      id: "connection-1",
      source: { deviceId: "router-1", interfaceId: "if-1" },
      target: { deviceId: "router-2", interfaceId: "if-2" }
    })), /Connection with ID "connection-1" already exists/);
  });

  test("rejects a reversed duplicate connection", () => {
    const topology = createConnectedTopology();

    assert.throws(() => topology.addConnection(new NetworkConnection({
      id: "connection-2",
      source: { deviceId: "router-2", interfaceId: "if-2" },
      target: { deviceId: "router-1", interfaceId: "if-1" }
    })), /connection between these endpoints already exists/i);
  });

  test("rejects a connection with an unknown device", () => {
    const topology = createTopology();
    topology.addDevice(createDevice("router-1", "Router1", "if-1"));

    assert.throws(() => topology.addConnection(new NetworkConnection({
      id: "connection-1",
      source: { deviceId: "router-1", interfaceId: "if-1" },
      target: { deviceId: "unknown", interfaceId: "if-2" }
    })), /Device with ID "unknown" does not exist/);
  });

  test("rejects a connection with an unknown interface", () => {
    const topology = createTopologyWithTwoDevices();

    assert.throws(() => topology.addConnection(new NetworkConnection({
      id: "connection-1",
      source: { deviceId: "router-1", interfaceId: "unknown" },
      target: { deviceId: "router-2", interfaceId: "if-2" }
    })), /Interface with ID "unknown" does not exist/);
  });

  test("prevents an interface from being connected twice", () => {
    const topology = createConnectedTopology();
    topology.addDevice(createDevice("router-3", "Router3", "if-3"));

    assert.throws(() => topology.addConnection(new NetworkConnection({
      id: "connection-2",
      source: { deviceId: "router-1", interfaceId: "if-1" },
      target: { deviceId: "router-3", interfaceId: "if-3" }
    })), /Interface "if-1" on device "router-1" is already connected/);
  });

  test("removes all related connections when removing a device", () => {
    const topology = createConnectedTopology();

    topology.removeDevice("router-1");

    assert.strictEqual(topology.findDevice("router-1"), undefined);
    assert.strictEqual(topology.connections.length, 0);
    assert.notStrictEqual(topology.findDevice("router-2"), undefined);
  });
});

function createTopology(): NetworkTopology {
  return new NetworkTopology({ id: "top-1", name: "Lab" });
}

function createTopologyWithTwoDevices(): NetworkTopology {
  const topology = createTopology();
  topology.addDevice(createDevice("router-1", "Router1", "if-1"));
  topology.addDevice(createDevice("router-2", "Router2", "if-2"));
  return topology;
}

function createConnectedTopology(): NetworkTopology {
  const topology = createTopologyWithTwoDevices();
  topology.addConnection(new NetworkConnection({
    id: "connection-1",
    source: { deviceId: "router-1", interfaceId: "if-1" },
    target: { deviceId: "router-2", interfaceId: "if-2" }
  }));
  return topology;
}

function createDevice(
  id: string,
  hostname: string,
  interfaceId: string
): NetworkDevice {
  const device = new NetworkDevice({ id, hostname, type: DeviceType.Router });
  device.addInterface(new NetworkInterface({
    id: interfaceId,
    name: `GigabitEthernet0/${interfaceId.slice(-1)}`,
    type: InterfaceType.GigabitEthernet
  }));
  return device;
}
