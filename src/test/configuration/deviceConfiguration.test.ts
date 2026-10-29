import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ProtocolType } from "../../models/protocolType";
import { InterfaceType } from "../../models/interfaceType";
import { NetworkDevice } from "../../models/networkDevice";
import { NetworkInterface } from "../../models/networkInterface";
import { NetworkProtocol } from "../../models/networkProtocol";
import { TopologyStore } from "../../modules/topology/TopologyStore";
import type { Device } from "../../modules/topology/models";
import { buildConfiguredDevice, configurationOf, toNetworkDevice } from "../../shared/deviceConfiguration";
import { parseWebviewMessage } from "../../modules/topology/view/parseWebviewMessage";
import { DeviceConfigurationValidationError } from "../../shared/validateDeviceConfiguration";

suite("H2c device configuration", () => {
    const device: Device = {
        id: "r1", topologyId: "topology", hostname: "R1", label: "R1", type: "router",
        interfaces: [{ id: "gi0", deviceId: "r1", name: "GigabitEthernet0/0", status: "up" }]
    };

    test("Legacy devices activate only connected interfaces by default", () => {
        const draft = configurationOf(device);
        assert.deepStrictEqual(draft.interfaces[0], {
            id: "gi0", enabled: false, ipAddress: "", subnetMask: "", description: "", layer: 3
        });
        assert.deepStrictEqual(draft.protocols, []);
        assert.strictEqual(buildConfiguredDevice(device, draft, []).id, device.id);
        assert.strictEqual(configurationOf(device, ["gi0"]).interfaces[0].enabled, true);
        assert.strictEqual(configurationOf({ ...device, interfaces: [{ ...device.interfaces[0], enabled: false }] },
            ["gi0"]).interfaces[0].enabled, false);
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

    test("Stored devices rehydrate as H1c classes with stable IDs and explicit interface types", () => {
        const stored: Device = {
            ...device,
            interfaces: [{ ...device.interfaces[0], name: "uplink", type: InterfaceType.FastEthernet,
                enabled: false, ipAddress: "10.0.0.1", subnetMask: "255.255.255.0" }],
            protocols: [{ id: "existing-ospf-id", type: ProtocolType.Ospf, enabled: false }]
        };
        const before = JSON.stringify(stored);
        const model = toNetworkDevice(stored);
        assert.ok(model instanceof NetworkDevice);
        assert.ok(model.interfaces[0] instanceof NetworkInterface);
        assert.ok(model.protocols[0] instanceof NetworkProtocol);
        assert.strictEqual(model.id, stored.id);
        assert.strictEqual(model.interfaces[0].id, stored.interfaces[0].id);
        assert.strictEqual(model.interfaces[0].type, InterfaceType.FastEthernet);
        assert.strictEqual(model.protocols[0].id, "existing-ospf-id");
        assert.strictEqual(model.protocols[0].enabled, false);
        assert.strictEqual(JSON.stringify(stored), before);
        model.interfaces[0].clearIpConfiguration();
        model.protocols[0].enable();
        const again = toNetworkDevice(stored);
        assert.strictEqual(again.interfaces[0].ipAddress, "10.0.0.1");
        assert.strictEqual(again.protocols[0].enabled, false);
    });

    test("Legacy defaults apply when loading an H1c model directly", () => {
        const model = toNetworkDevice(device);
        assert.strictEqual(model.interfaces[0].enabled, false);
        assert.strictEqual(model.interfaces[0].ipAddress, undefined);
        assert.strictEqual(model.interfaces[0].subnetMask, undefined);
        assert.strictEqual(model.interfaces[0].type, InterfaceType.GigabitEthernet);
        assert.deepStrictEqual(model.protocols, []);
    });

    test("Example JSON loads directly through the store without a form, including legacy schema 1", async () => {
        const uri = vscode.Uri.file(path.join(os.tmpdir(), `topocheck-h2c-example-${Date.now()}`));
        const store = new TopologyStore(uri);
        const restarted = new TopologyStore(uri);
        try {
            const exampleBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(
                path.resolve(__dirname, "../../../test-workspace/h2c-topology.json")));
            await vscode.workspace.fs.createDirectory(uri);
            const file = vscode.Uri.joinPath(uri, "h2c-example.json");
            await vscode.workspace.fs.writeFile(file, exampleBytes);
            const router = await store.loadNetworkDevice("h2c-example", "router-example");
            assert.ok(router instanceof NetworkDevice);
            assert.strictEqual(router.interfaces[0].ipAddress, "10.0.0.1");
            assert.strictEqual(router.interfaces[1].enabled, false);
            assert.strictEqual(router.protocols[0].id, "router-example-ospf");
            const legacy = await store.loadNetworkDevice("h2c-example", "pc-legacy");
            assert.strictEqual(legacy.interfaces[0].enabled, true);
            assert.deepStrictEqual(legacy.protocols, []);
            // Mapping alone must not rewrite the stored JSON.
            assert.deepStrictEqual(await vscode.workspace.fs.readFile(file), exampleBytes);
            const topology = await store.loadTopology("h2c-example");
            const draft = configurationOf(topology.devices[0]);
            draft.hostname = "RouterSavedWithoutForm";
            await store.configureDevice(topology.id, topology.devices[0].id, draft);
            const reloaded = await restarted.loadNetworkDevice(topology.id, topology.devices[0].id);
            assert.strictEqual(reloaded.hostname, draft.hostname);
            assert.strictEqual(reloaded.interfaces[0].id, router.interfaces[0].id);
            assert.strictEqual(reloaded.protocols[0].id, router.protocols[0].id);
            assert.deepStrictEqual((await restarted.loadTopology(topology.id)).connections, topology.connections);
            await assert.rejects(() => store.loadNetworkDevice(topology.id, "missing"), (error: unknown) =>
                error instanceof DeviceConfigurationValidationError && error.errors[0].field === "deviceId");
            const old = JSON.parse(Buffer.from(exampleBytes).toString("utf8"));
            old.schemaVersion = 1;
            delete old.layout;
            await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(old)));
            assert.strictEqual((await restarted.loadNetworkDevice("h2c-example", "pc-legacy"))
                .interfaces[0].enabled, true);
        } finally {
            store.dispose(); restarted.dispose();
            await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
        }
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
            draft.label = "Router Wien";
            draft.domainName = "schule.at";
            draft.username = "admin";
            draft.enableSecret = "test-only-enable";
            draft.consolePassword = "test-only-console";
            draft.vtyPassword = "test-only-vty";
            draft.banner = "Authorized Access Only\nSchulungsnetz";
            draft.interfaces[0].ipAddress = "10.0.0.1";
            draft.interfaces[0].subnetMask = "255.255.255.0";
            draft.interfaces[0].enabled = false;
            draft.interfaces[0].description = "Uplink zum Switch";
            draft.interfaces[0].layer = 2;
            draft.protocols = [{ type: ProtocolType.Ospf, enabled: false }];
            await store.configureDevice(topology.id, router.id, draft);
            const loaded = await restarted.loadTopology(topology.id);
            const configured = loaded.devices.find((item) => item.id === router.id)!;
            const h1c = await restarted.loadNetworkDevice(topology.id, router.id);
            assert.ok(h1c instanceof NetworkDevice);
            assert.strictEqual(h1c.interfaces[0].id, router.interfaces[0].id);
            assert.strictEqual(h1c.interfaces[0].enabled, false);
            assert.strictEqual(h1c.protocols[0].enabled, false);
            assert.strictEqual(configured.label, "Router Wien");
            assert.strictEqual(h1c.hostname, "RouterConfigured");
            for (const key of ["domainName", "username", "enableSecret", "consolePassword", "vtyPassword", "banner"] as const) {
                assert.strictEqual(h1c[key], draft[key]);
                assert.strictEqual(configured[key], draft[key]);
            }
            assert.strictEqual(h1c.interfaces[0].description, "Uplink zum Switch");
            assert.strictEqual(h1c.interfaces[0].layer, 2);
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
            await assert.rejects(() => store.configureDevice(topology.id, router.id, draft), (error: unknown) =>
                error instanceof DeviceConfigurationValidationError &&
                error.errors.some((issue) => issue.field === "interfaces.0.ipAddress"));
            assert.deepStrictEqual(await store.loadTopology(topology.id), saved);
            const clear = configurationOf(configured);
            clear.interfaces[0].ipAddress = "";
            clear.interfaces[0].subnetMask = "";
            clear.protocols = [];
            clear.domainName = "";
            clear.username = "";
            clear.enableSecret = "";
            clear.consolePassword = "";
            clear.vtyPassword = "";
            clear.banner = "";
            clear.interfaces[0].description = "";
            await store.configureDevice(topology.id, router.id, clear);
            const cleared = (await store.loadTopology(topology.id)).devices.find((item) => item.id === router.id)!;
            assert.strictEqual(cleared.interfaces[0].ipAddress, undefined);
            assert.deepStrictEqual(cleared.protocols, []);
            for (const key of ["domainName", "username", "enableSecret", "consolePassword", "vtyPassword", "banner"] as const) {
                assert.strictEqual(cleared[key], undefined);
            }
            assert.strictEqual(cleared.interfaces[0].description, undefined);
        } finally {
            store.dispose(); restarted.dispose();
            await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
        }
    });

    test("Unused ports start disabled; connecting activates endpoints and disconnecting disables them", async () => {
        const uri = vscode.Uri.file(path.join(os.tmpdir(), `topocheck-port-activation-${Date.now()}`));
        const store = new TopologyStore(uri);
        try {
            const topology = await store.createTopology("Port activation");
            const router = await store.addDevice(topology.id, { type: "router" });
            const pc = await store.addDevice(topology.id, { type: "pc" });
            const spare = await store.addInterface(topology.id, router.id, "Loopback0");
            assert.ok(router.interfaces.every((iface) => iface.enabled === false));
            assert.strictEqual(spare.enabled, false);
            const connection = await store.addConnection(topology.id, router.interfaces[0].id, pc.interfaces[0].id);
            let loaded = await store.loadTopology(topology.id);
            assert.strictEqual(loaded.devices.find((item) => item.id === router.id)!.interfaces[0].enabled, true);
            assert.strictEqual(loaded.devices.find((item) => item.id === router.id)!.interfaces[1].enabled, false);
            assert.strictEqual(loaded.devices.find((item) => item.id === pc.id)!.interfaces[0].enabled, true);
            const draft = configurationOf(loaded.devices.find((item) => item.id === router.id)!);
            draft.interfaces[0].enabled = false;
            await store.configureDevice(topology.id, router.id, draft);
            assert.strictEqual((await store.loadNetworkDevice(topology.id, router.id)).interfaces[0].enabled, false);
            await store.removeConnection(topology.id, connection.id);
            loaded = await store.loadTopology(topology.id);
            assert.ok(loaded.devices.every((item) => item.interfaces.every((iface) => iface.enabled === false)));
            await store.addConnection(topology.id, router.interfaces[0].id, pc.interfaces[0].id);
            assert.strictEqual((await store.loadNetworkDevice(topology.id, router.id)).interfaces[0].enabled, true);
            await store.removeDevice(topology.id, pc.id);
            assert.strictEqual((await store.loadNetworkDevice(topology.id, router.id)).interfaces[0].enabled, false);
        } finally {
            store.dispose();
            await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
        }
    });
});
