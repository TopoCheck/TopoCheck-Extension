import * as assert from "assert";
import { randomUUID } from "crypto";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { TopologyChangeEvent, TopologyChangeType, TopologyFileWriter, TopologyStore } from "../modules/topology/TopologyStore";
import type { Device, Topology } from "../modules/topology/models";
import { configurationOf } from "../shared/deviceConfiguration";

suite("H2c atomic save", () => {
    let uri: vscode.Uri;
    let file: vscode.Uri;
    let store: TopologyStore;
    let topology: Topology;
    let device: Device;
    let before: Uint8Array;
    let events: TopologyChangeEvent[];
    let eventReads: Thenable<Uint8Array>[];
    let failure: "write" | "rename" | undefined;
    let writes: number;
    let renames: number;
    let pauseRename: (() => Promise<void>) | undefined;

    setup(async () => {
        uri = vscode.Uri.file(path.join(os.tmpdir(), `topocheck-atomic-${randomUUID()}`));
        writes = 0; renames = 0; failure = undefined; pauseRename = undefined;
        events = []; eventReads = [];
        const writer: TopologyFileWriter = {
            createDirectory: (target) => vscode.workspace.fs.createDirectory(target),
            delete: (target, options) => vscode.workspace.fs.delete(target, options),
            writeFile: async (target, content) => {
                writes++;
                if (failure === "write") {
                    failure = undefined;
                    await vscode.workspace.fs.writeFile(target, content.subarray(0, 20));
                    throw new Error("Simulated partial write failure");
                }
                await vscode.workspace.fs.writeFile(target, content);
            },
            rename: async (source, target, options) => {
                if (pauseRename) { await pauseRename(); }
                if (failure === "rename") {
                    failure = undefined;
                    throw new Error("Simulated file replacement failure");
                }
                await vscode.workspace.fs.rename(source, target, options);
                renames++;
            }
        };
        store = new TopologyStore(uri, writer);
        topology = await store.createTopology("Atomic save");
        device = await store.addDevice(topology.id, { type: "router" });
        const peer = await store.addDevice(topology.id, { type: "pc" });
        await store.addConnection(topology.id, device.interfaces[0].id, peer.interfaces[0].id);
        topology = await store.loadTopology(topology.id);
        device = topology.devices.find((item) => item.id === device.id)!;
        file = vscode.Uri.joinPath(uri, `${topology.id}.json`);
        before = await vscode.workspace.fs.readFile(file);
        writes = 0; renames = 0;
        store.onDidChangeTopology((event) => {
            events.push(event);
            eventReads.push(vscode.workspace.fs.readFile(file));
        });
    });

    teardown(async () => {
        store.dispose();
        await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    });

    async function assertUnchanged(): Promise<void> {
        assert.deepStrictEqual(await vscode.workspace.fs.readFile(file), before);
        assert.deepStrictEqual(events, []);
        assert.ok((await vscode.workspace.fs.readDirectory(uri)).every(([name]) => !name.endsWith(".tmp")));
    }

    test("Saves the whole configuration once and emits exactly one event after replacement", async () => {
        const draft = configurationOf(device);
        draft.hostname = "RouterSaved";
        draft.label = "Router Wien";
        draft.domainName = "schule.at";
        draft.interfaces[0].ipAddress = "10.0.0.1";
        draft.interfaces[0].subnetMask = "255.255.255.0";
        await store.configureDevice(topology.id, device.id, draft);
        assert.strictEqual(writes, 1);
        assert.strictEqual(renames, 1);
        assert.deepStrictEqual(events, [{ type: TopologyChangeType.DeviceConfigUpdated, topologyId: topology.id, deviceId: device.id }]);
        const eventSnapshot: Topology = JSON.parse(Buffer.from(await eventReads[0]).toString("utf8"));
        const saved = eventSnapshot.devices.find((item) => item.id === device.id)!;
        assert.strictEqual(saved.hostname, draft.hostname);
        assert.strictEqual(saved.domainName, draft.domainName);
        assert.strictEqual(saved.interfaces[0].ipAddress, "10.0.0.1");
        assert.deepStrictEqual(eventSnapshot.connections, topology.connections);
        assert.deepStrictEqual(eventSnapshot.layout, topology.layout);
        assert.strictEqual(device.hostname, "R1");
    });

    test("Invalid fields reject all changes before writing or emitting an event", async () => {
        const draft = configurationOf(device);
        draft.hostname = "ShouldNotBeSaved";
        draft.domainName = "schule.at";
        draft.interfaces[0].ipAddress = "999.1.1.1";
        draft.interfaces[0].subnetMask = "255.255.255.0";
        await assert.rejects(() => store.configureDevice(topology.id, device.id, draft));
        assert.strictEqual(writes, 0);
        assert.strictEqual(renames, 0);
        await assertUnchanged();
    });

    test("An invalid draft does not persist automatic legacy repairs", async () => {
        const legacy = structuredClone(topology);
        legacy.devices.find((item) => item.id === device.id)!.interfaces = [];
        before = Buffer.from(JSON.stringify(legacy));
        await vscode.workspace.fs.writeFile(file, before);
        const draft = configurationOf(device);
        draft.hostname = "";
        await assert.rejects(() => store.configureDevice(topology.id, device.id, draft));
        assert.strictEqual(writes, 0);
        await assertUnchanged();
    });

    for (const mode of ["write", "rename"] as const) {
        test(`A ${mode} failure preserves the original, cleans temporary files and permits retry`, async () => {
            const draft = configurationOf(device);
            draft.hostname = "RouterRetried";
            failure = mode;
            await assert.rejects(() => store.configureDevice(topology.id, device.id, draft), /Simulated/);
            await assertUnchanged();
            assert.strictEqual(device.hostname, "R1");
            await store.configureDevice(topology.id, device.id, draft);
            assert.strictEqual((await store.loadNetworkDevice(topology.id, device.id)).hostname, draft.hostname);
            assert.strictEqual(events.length, 1);
        });
    }

    test("Queued saves use input snapshots and expose no intermediate file contents", async () => {
        let signalStarted!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => { signalStarted = resolve; });
        const wait = new Promise<void>((resolve) => { release = resolve; });
        pauseRename = async () => { pauseRename = undefined; signalStarted(); await wait; };
        const firstDraft = configurationOf(device);
        firstDraft.hostname = "FirstSaved";
        const first = store.configureDevice(topology.id, device.id, firstDraft);
        await started;
        const secondDraft = configurationOf(device);
        secondDraft.hostname = "SecondSaved";
        const second = store.configureDevice(topology.id, device.id, secondDraft);
        // Neither mutation may affect the request already handed to the store.
        firstDraft.hostname = "MutatedFirst";
        secondDraft.interfaces[0].ipAddress = "999.1.1.1";
        secondDraft.hostname = "MutatedSecond";
        try {
            assert.deepStrictEqual(await vscode.workspace.fs.readFile(file), before);
            assert.deepStrictEqual(events, []);
        } finally { release(); }
        await Promise.all([first, second]);
        assert.strictEqual((await store.loadNetworkDevice(topology.id, device.id)).hostname, "SecondSaved");
        assert.strictEqual(events.length, 2);
        assert.strictEqual(writes, 2);
        assert.strictEqual(renames, 2);
        const observed = await Promise.all(eventReads);
        assert.ok(observed.every((bytes) => JSON.parse(Buffer.from(bytes).toString("utf8")).devices.length === 2));
        assert.ok((await vscode.workspace.fs.readDirectory(uri)).every(([name]) => !name.endsWith(".tmp")));
    });
});
