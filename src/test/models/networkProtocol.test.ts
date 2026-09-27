import * as assert from "assert";
import { NetworkProtocol } from "../../models/networkProtocol";
import { ProtocolType } from "../../models/protocolType";

suite("NetworkProtocol", () => {
  test("creates an enabled protocol by default", () => {
    const protocol = new NetworkProtocol({
      id: "ospf-1",
      type: ProtocolType.Ospf
    });

    assert.strictEqual(protocol.id, "ospf-1");
    assert.strictEqual(protocol.type, ProtocolType.Ospf);
    assert.strictEqual(protocol.enabled, true);
  });

  test("rejects an empty protocol ID", () => {
    assert.throws(() => new NetworkProtocol({
      id: " ",
      type: ProtocolType.Ospf
    }), /Protocol ID must not be empty/);
  });

  test("enables and disables a protocol", () => {
    const protocol = new NetworkProtocol({
      id: "rip-1",
      type: ProtocolType.Rip,
      enabled: false
    });

    protocol.enable();
    assert.strictEqual(protocol.enabled, true);

    protocol.disable();
    assert.strictEqual(protocol.enabled, false);
  });
});
