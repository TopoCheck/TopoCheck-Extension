import * as assert from "assert";
import { InterfaceType } from "../../models/interfaceType";
import { NetworkInterface } from "../../models/networkInterface";

suite("NetworkInterface", () => {
  test("creates an interface with defaults", () => {
    const networkInterface = new NetworkInterface({
      id: "if-1",
      name: "GigabitEthernet0/0",
      type: InterfaceType.GigabitEthernet
    });

    assert.strictEqual(networkInterface.id, "if-1");
    assert.strictEqual(networkInterface.enabled, true);
    assert.strictEqual(networkInterface.ipAddress, undefined);
    assert.strictEqual(networkInterface.subnetMask, undefined);
  });

  test("rejects an empty ID or name", () => {
    assert.throws(() => new NetworkInterface({
      id: " ",
      name: "GigabitEthernet0/0",
      type: InterfaceType.GigabitEthernet
    }), /Interface ID must not be empty/);

    assert.throws(() => new NetworkInterface({
      id: "if-1",
      name: " ",
      type: InterfaceType.GigabitEthernet
    }), /Interface name must not be empty/);
  });

  test("sets and clears an IPv4 configuration", () => {
    const networkInterface = new NetworkInterface({
      id: "if-1",
      name: "GigabitEthernet0/0",
      type: InterfaceType.GigabitEthernet
    });

    networkInterface.setIpConfiguration("192.168.1.1", "255.255.255.0");
    assert.strictEqual(networkInterface.ipAddress, "192.168.1.1");
    assert.strictEqual(networkInterface.subnetMask, "255.255.255.0");

    networkInterface.clearIpConfiguration();
    assert.strictEqual(networkInterface.ipAddress, undefined);
    assert.strictEqual(networkInterface.subnetMask, undefined);
  });

  test("requires address and mask together", () => {
    assert.throws(() => new NetworkInterface({
      id: "if-1",
      name: "GigabitEthernet0/0",
      type: InterfaceType.GigabitEthernet,
      ipAddress: "192.168.1.1"
    }), /must be provided together/);
  });

  test("rejects invalid IPv4 values", () => {
    const networkInterface = new NetworkInterface({
      id: "if-1",
      name: "GigabitEthernet0/0",
      type: InterfaceType.GigabitEthernet
    });

    assert.throws(
      () => networkInterface.setIpConfiguration("192.168.1.999", "255.255.255.0"),
      /Invalid IPv4 address/
    );
    assert.throws(
      () => networkInterface.setIpConfiguration("192.168.1.1", "255.255.999.0"),
      /Invalid subnet mask/
    );
  });

  test("enables and disables an interface", () => {
    const networkInterface = new NetworkInterface({
      id: "if-1",
      name: "GigabitEthernet0/0",
      type: InterfaceType.GigabitEthernet,
      enabled: false
    });

    networkInterface.enable();
    assert.strictEqual(networkInterface.enabled, true);

    networkInterface.disable();
    assert.strictEqual(networkInterface.enabled, false);
  });
});
