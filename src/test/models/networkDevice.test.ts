import * as assert from "assert";
import { DeviceType } from "../../models/deviceType";
import { InterfaceType } from "../../models/interfaceType";
import { NetworkDevice } from "../../models/networkDevice";
import { NetworkInterface } from "../../models/networkInterface";
import { NetworkProtocol } from "../../models/networkProtocol";
import { ProtocolType } from "../../models/protocolType";

suite("NetworkDevice", () => {
  test("creates a device and trims its identity fields", () => {
    const device = new NetworkDevice({
      id: " router-1 ",
      hostname: " Router1 ",
      type: DeviceType.Router
    });

    assert.strictEqual(device.id, "router-1");
    assert.strictEqual(device.hostname, "Router1");
    assert.strictEqual(device.type, DeviceType.Router);
  });

  test("rejects an empty ID or hostname", () => {
    assert.throws(() => new NetworkDevice({
      id: " ",
      hostname: "Router1",
      type: DeviceType.Router
    }), /Device ID must not be empty/);

    assert.throws(() => new NetworkDevice({
      id: "router-1",
      hostname: " ",
      type: DeviceType.Router
    }), /Hostname must not be empty/);
  });

  test("adds, finds and removes an interface", () => {
    const device = createRouter();
    const networkInterface = createInterface("if-1", "GigabitEthernet0/0");

    device.addInterface(networkInterface);
    assert.strictEqual(device.findInterface("if-1"), networkInterface);
    assert.strictEqual(device.interfaces.length, 1);

    assert.strictEqual(device.removeInterface("if-1"), true);
    assert.strictEqual(device.findInterface("if-1"), undefined);
    assert.strictEqual(device.removeInterface("unknown"), false);
  });

  test("rejects duplicate interface IDs and names", () => {
    const device = createRouter();
    device.addInterface(createInterface("if-1", "GigabitEthernet0/0"));

    assert.throws(
      () => device.addInterface(createInterface("if-1", "GigabitEthernet0/1")),
      /Interface with ID "if-1" already exists/
    );
    assert.throws(
      () => device.addInterface(createInterface("if-2", "GigabitEthernet0/0")),
      /Interface with name "GigabitEthernet0\/0" already exists/
    );
  });

  test("adds, finds and removes a compatible protocol", () => {
    const device = createRouter();
    const protocol = new NetworkProtocol({
      id: "ospf-1",
      type: ProtocolType.Ospf
    });

    device.addProtocol(protocol);
    assert.strictEqual(device.findProtocol("ospf-1"), protocol);
    assert.strictEqual(device.protocols.length, 1);

    assert.strictEqual(device.removeProtocol("ospf-1"), true);
    assert.strictEqual(device.findProtocol("ospf-1"), undefined);
    assert.strictEqual(device.removeProtocol("unknown"), false);
  });

  test("rejects duplicate protocol IDs and types", () => {
    const device = createRouter();
    device.addProtocol(new NetworkProtocol({
      id: "ospf-1",
      type: ProtocolType.Ospf
    }));

    assert.throws(() => device.addProtocol(new NetworkProtocol({
      id: "ospf-1",
      type: ProtocolType.Rip
    })), /Protocol with ID "ospf-1" already exists/);

    assert.throws(() => device.addProtocol(new NetworkProtocol({
      id: "ospf-2",
      type: ProtocolType.Ospf
    })), /Protocol type "ospf" already exists/);
  });

  test("enforces protocol compatibility", () => {
    const pc = new NetworkDevice({
      id: "pc-1",
      hostname: "PC1",
      type: DeviceType.Pc
    });

    assert.throws(() => pc.addProtocol(new NetworkProtocol({
      id: "ospf-1",
      type: ProtocolType.Ospf
    })), /is not compatible with device type "pc"/);
  });
});

function createRouter(): NetworkDevice {
  return new NetworkDevice({
    id: "router-1",
    hostname: "Router1",
    type: DeviceType.Router
  });
}

function createInterface(id: string, name: string): NetworkInterface {
  return new NetworkInterface({
    id,
    name,
    type: InterfaceType.GigabitEthernet
  });
}
