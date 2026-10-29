import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ProtocolType } from "../models/protocolType";
import { TopologyStore } from "../modules/topology/TopologyStore";
import type { Device } from "../modules/topology/models";
import { buildConfiguredDevice, configurationOf } from "../shared/deviceConfiguration";
import { parseWebviewMessage } from "../modules/topology/view/parseWebviewMessage";

suite("H2c device configuration", () => {
    const device: Device = {
        id: "r1", topologyId: "topology", hostname: "R1", label: "R1", type: "router",
        interfaces: [{ id: "gi0", deviceId: "r1", name: "GigabitEthernet0/0", status: "up" }]
    };

    test("Legacy devices default to enabled interfaces and no protocols", () => {
        const draft = configurationOf(device);
        assert.deepStrictEqual(draft.interfaces[0], {
            id: "gi0", enabled: true, ipAddress: "", subnetMask: ""
        });
        assert.deepStrictEqual(draft.protocols, []);
        assert.strictEqual(buildConfiguredDevice(device, draft, []).id, device.id);
    });

    test("IPv4 and protocol drafts become H1c objects without changing the source", () => {
        const draft = configurationOf(device);
        draft.interfaces[0] = { id: "gi0", enabled: false, ipAddress: "10.0.0.1", subnetMask: "255.255.255.252" };
        draft.protocols = [{ type: ProtocolType.Ospf, enabled: true }];
        const model = buildConfiguredDevice(device, draft, []);
        assert.strictEqual(model.interfaces[0].ipAddress, "10.0.0.1");
        assert.strictEqual(model.interfaces[0].enabled, false);
        assert.strictEqual(model.protocols[0].type, ProtocolType.Ospf);
        assert.strictEqual(device.interfaces[0].ipAddress, undefined);
    });

    test("Invalid addresses, masks, incomplete pairs and stale interface IDs are rejected", () => {
        for (const [ipAddress, subnetMask] of [
            ["999.1.1.1", "255.255.255.0"], ["10.0.0.1", "255.0.255.0"],
            ["10.0.0.1", ""], ["", "255.255.255.0"], ["10.0.0.1", "255.255.255.999"]
        ]) {
            const draft = configurationOf(device);
            Object.assign(draft.interfaces[0], { ipAddress, subnetMask });
            assert.throws(() => buildConfiguredDevice(device, draft, []));
        }
        const stale = configurationOf(device);
        stale.interfaces[0].id = "missing";
        assert.throws(() => buildConfiguredDevice(device, stale, []));
        stale.interfaces = [];
        assert.throws(() => buildConfiguredDevice(device, stale, []));
    });

    test("Hostname uniqueness and device-specific protocol rules are enforced", () => {
        const draft = configurationOf(device);
        draft.hostname = "Router2";
        assert.throws(() => buildConfiguredDevice(device, draft, ["router2"]));
        draft.hostname = "";
        assert.throws(() => buildConfiguredDevice(device, draft, []));
        draft.hostname = "R1";
        draft.protocols = [{ type: ProtocolType.Vlan, enabled: true }];
        assert.throws(() => buildConfiguredDevice(device, draft, []));
        draft.protocols = [
            { type: ProtocolType.Ospf, enabled: true }, { type: ProtocolType.Ospf, enabled: false }
        ];
        assert.throws(() => buildConfiguredDevice(device, draft, []));
    });

    test("Malformed Webview payloads are rejected", () => {
        const message = { type: "configureDevice", deviceId: device.id, configuration: configurationOf(device) };
        assert.deepStrictEqual(parseWebviewMessage(message), message);
        for (const configuration of [null, {}, { ...message.configuration, interfaces: [null] },
            { ...message.configuration, protocols: [{ type: "unknown", enabled: true }] },
            { ...message.configuration, interfaces: [{ id: "gi0", enabled: "yes", ipAddress: "", subnetMask: "" }] }]) {
            assert.strictEqual(parseWebviewMessage({ ...message, configuration }), undefined);
        }
    });

    test("Saving survives reload, preserves cables and rejects invalid drafts atomically", async () => {
        const uri = vscode.Uri.file(path.join(os.tmpdir(), `topocheck-h2c-${Date.now()}`));
        const store = new TopologyStore(uri);
        const restarted = new TopologyStore(uri);
        try {
            const topology = await store.createTopology("H2c");
            const router = await store.addDevice(topology.id, { type: "router" });
            const pc = await store.addDevice(topology.id, { type: "pc" });
            await store.addConnection(topology.id, router.interfaces[0].id, pc.interfaces[0].id);
            const before = await store.loadTopology(topology.id);
            const draft = configurationOf(before.devices.find((item) => item.id === router.id)!);
            draft.hostname = "RouterConfigured";
            draft.interfaces[0].ipAddress = "10.0.0.1";
            draft.interfaces[0].subnetMask = "255.255.255.0";
            draft.interfaces[0].enabled = false;
            draft.protocols = [{ type: ProtocolType.Ospf, enabled: false }];
            await store.configureDevice(topology.id, router.id, draft);
            const loaded = await restarted.loadTopology(topology.id);
            const configured = loaded.devices.find((item) => item.id === router.id)!;
            assert.strictEqual(configured.hostname, draft.hostname);
            assert.strictEqual(configured.interfaces[0].ipAddress, "10.0.0.1");
            assert.strictEqual(configured.interfaces[0].enabled, false);
            assert.deepStrictEqual(loaded.connections, before.connections);
            assert.strictEqual(configured.protocols![0].enabled, false);
            const protocolId = configured.protocols![0].id;
            await store.configureDevice(topology.id, router.id, draft);
            assert.strictEqual((await store.loadTopology(topology.id)).devices
                .find((item) => item.id === router.id)!.protocols![0].id, protocolId);
            const saved = await store.loadTopology(topology.id);
            draft.hostname = "ShouldNotBeSaved";
            draft.interfaces[0].ipAddress = "999.1.1.1";
            await assert.rejects(() => store.configureDevice(topology.id, router.id, draft));
            assert.deepStrictEqual(await store.loadTopology(topology.id), saved);
            const clear = configurationOf(configured);
            clear.interfaces[0].ipAddress = "";
            clear.interfaces[0].subnetMask = "";
            clear.protocols = [];
            await store.configureDevice(topology.id, router.id, clear);
            const cleared = (await store.loadTopology(topology.id)).devices.find((item) => item.id === router.id)!;
            assert.strictEqual(cleared.interfaces[0].ipAddress, undefined);
            assert.deepStrictEqual(cleared.protocols, []);
        } finally {
            store.dispose(); restarted.dispose();
            await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
        }
    });
});
