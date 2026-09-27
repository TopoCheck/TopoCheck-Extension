import * as assert from "assert";
import { NetworkConnection } from "../../models/networkConnection";

suite("NetworkConnection", () => {
  test("creates a connection and recognizes its endpoints", () => {
    const connection = createConnection();

    assert.strictEqual(connection.usesDevice("router-1"), true);
    assert.strictEqual(connection.usesDevice("router-3"), false);
    assert.strictEqual(connection.usesInterface("router-2", "if-2"), true);
    assert.strictEqual(connection.usesInterface("router-2", "unknown"), false);
  });

  test("trims and copies endpoint values", () => {
    const source = { deviceId: " router-1 ", interfaceId: " if-1 " };
    const connection = new NetworkConnection({
      id: " connection-1 ",
      source,
      target: { deviceId: "router-2", interfaceId: "if-2" }
    });

    source.deviceId = "changed";

    assert.strictEqual(connection.id, "connection-1");
    assert.strictEqual(connection.source.deviceId, "router-1");
    assert.strictEqual(connection.source.interfaceId, "if-1");
  });

  test("rejects empty identity fields", () => {
    assert.throws(() => new NetworkConnection({
      id: " ",
      source: { deviceId: "router-1", interfaceId: "if-1" },
      target: { deviceId: "router-2", interfaceId: "if-2" }
    }), /Connection ID must not be empty/);

    assert.throws(() => new NetworkConnection({
      id: "connection-1",
      source: { deviceId: " ", interfaceId: "if-1" },
      target: { deviceId: "router-2", interfaceId: "if-2" }
    }), /Source device ID must not be empty/);
  });

  test("rejects a self-connection", () => {
    assert.throws(() => new NetworkConnection({
      id: "connection-1",
      source: { deviceId: "router-1", interfaceId: "if-1" },
      target: { deviceId: "router-1", interfaceId: "if-1" }
    }), /cannot be connected to itself/);
  });

  test("recognizes reversed connections as equal endpoints", () => {
    const connection = createConnection();
    const reversed = new NetworkConnection({
      id: "connection-2",
      source: { deviceId: "router-2", interfaceId: "if-2" },
      target: { deviceId: "router-1", interfaceId: "if-1" }
    });

    assert.strictEqual(connection.connectsSameEndpoints(reversed), true);
  });
});

function createConnection(): NetworkConnection {
  return new NetworkConnection({
    id: "connection-1",
    source: { deviceId: "router-1", interfaceId: "if-1" },
    target: { deviceId: "router-2", interfaceId: "if-2" }
  });
}
