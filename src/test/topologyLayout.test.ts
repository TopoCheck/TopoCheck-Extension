import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
    CURRENT_SCHEMA_VERSION,
    LayoutChangeEvent,
    TopologyChangeType,
    TopologyStore,
} from "../modules/topology";

suite("TopologyStore – Layout (H2a)", () => {
    let storageUri: vscode.Uri;
    let store: TopologyStore;

    setup(() => {
        storageUri = vscode.Uri.file(
            path.join(
                os.tmpdir(),
                `topocheck-layout-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
            )
        );
        store = new TopologyStore(storageUri);
    });

    teardown(async () => {
        store.dispose();
        try {
            await vscode.workspace.fs.delete(storageUri, { recursive: true, useTrash: false });
        } catch {
            // nichts aufzuräumen
        }
    });

    test("Position bleibt nach Neustart der Extension erhalten", async () => {
        const topology = await store.createTopology("Persistenz");
        const device = await store.addDevice(topology.id, { type: "router", position: { x: 140, y: 260 } });
        await store.moveDevices(topology.id, [{ deviceId: device.id, position: { x: 400, y: 80 } }]);

        const restartedStore = new TopologyStore(storageUri);
        try {
            const loaded = await restartedStore.loadTopology(topology.id);
            assert.deepStrictEqual(loaded.layout.devices[device.id], { x: 400, y: 80 });
        } finally {
            restartedStore.dispose();
        }
    });

    test("Verschieben löst nur ein Layout-Event aus, kein Modell-Event", async () => {
        const topology = await store.createTopology("Events");
        const device = await store.addDevice(topology.id, { type: "router" });

        const layoutEvents: LayoutChangeEvent[] = [];
        const modelEvents: TopologyChangeType[] = [];
        store.onDidChangeLayout((event) => layoutEvents.push(event));
        store.onDidChangeTopology((event) => modelEvents.push(event.type));

        await store.moveDevices(topology.id, [{ deviceId: device.id, position: { x: 0, y: 200 } }]);

        assert.strictEqual(layoutEvents.length, 1);
        assert.strictEqual(modelEvents.length, 0);
    });

    test("Gerät löschen entfernt auch seinen Layout-Eintrag", async () => {
        const topology = await store.createTopology("Aufräumen");
        const device = await store.addDevice(topology.id, { type: "router" });
        await store.removeDevice(topology.id, device.id);

        const loaded = await store.loadTopology(topology.id);
        assert.strictEqual(loaded.layout.devices[device.id], undefined);
    });

    test("Hostnamen werden automatisch vergeben und müssen eindeutig sein", async () => {
        const topology = await store.createTopology("Hostnamen");
        const r1 = await store.addDevice(topology.id, { type: "router" });
        const r2 = await store.addDevice(topology.id, { type: "router" });
        const sw1 = await store.addDevice(topology.id, { type: "switch" });
        assert.deepStrictEqual([r1.hostname, r2.hostname, sw1.hostname], ["R1", "R2", "SW1"]);

        await assert.rejects(
            () => store.updateDevice(topology.id, r2.id, { hostname: "r1" }),
            /bereits vergeben/
        );
    });

    test("Topologie im alten Schema 1 wird beim Laden migriert", async () => {
        const id = "legacy-topology";
        const legacy = {
            id,
            name: "Alt",
            schemaVersion: 1,
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z",
            devices: [{ id: "d1", topologyId: id, label: "R1", hostname: "R1", type: "router", interfaces: [] }],
            connections: [],
        };
        await vscode.workspace.fs.createDirectory(storageUri);
        await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(storageUri, `${id}.json`),
            Buffer.from(JSON.stringify(legacy), "utf8")
        );

        const loaded = await store.loadTopology(id);
        assert.strictEqual(loaded.schemaVersion, CURRENT_SCHEMA_VERSION);
        assert.ok(loaded.layout.devices.d1);
    });

    test("Verschieben und sofortiges Löschen: gelöschtes Gerät kommt nicht zurück", async () => {
        const topology = await store.createTopology("Verschieben + Löschen");
        const device = await store.addDevice(topology.id, { type: "router" });

        const move = store.moveDevices(topology.id, [{ deviceId: device.id, position: { x: 500, y: 500 } }]);
        const remove = store.removeDevice(topology.id, device.id);
        await Promise.all([move, remove]);

        const loaded = await store.loadTopology(topology.id);
        assert.strictEqual(loaded.devices.length, 0);
        assert.strictEqual(loaded.layout.devices[device.id], undefined);
    });
});
