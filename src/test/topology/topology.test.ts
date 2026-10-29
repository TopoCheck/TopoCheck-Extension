import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { TopologyChangeType, TopologyStore } from "../../modules/topology";

suite("TopologyStore Test Suite", () => {
    let storageUri: vscode.Uri;
    let store: TopologyStore;

    setup(() => {
        storageUri = vscode.Uri.file(
            path.join(
                os.tmpdir(),
                `topocheck-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
            )
        );
        store = new TopologyStore(storageUri);
    });

    teardown(async () => {
        store.dispose();
        try {
            await vscode.workspace.fs.delete(storageUri, {
                recursive: true,
                useTrash: false,
            });
        } catch {
            // Ordner wurde evtl. nie angelegt - dann gibts auch nichts aufzuräumen
        }
    });

    //Speichern/Laden

    test("Topology anlegen und wieder laden liefert denselben Inhalt", async () => {
        const created = await store.createTopology("Testszenario 1");
        const loaded = await store.loadTopology(created.id);

        assert.strictEqual(loaded.id, created.id);
        assert.strictEqual(loaded.name, "Testszenario 1");
        assert.strictEqual(loaded.devices.length, 0);
        assert.strictEqual(loaded.connections.length, 0);
    });

    test("Laden einer nicht existierenden Topology wirft einen Fehler", async () => {
        await assert.rejects(() => store.loadTopology("does-not-exist"));
    });

    test("Topology bleibt nach Neustart der Extension erhalten (Persistenz)", async () => {
        const created = await store.createTopology("Persistenz-Test");
        await store.addDevice(created.id, {
            label: "R1",
            hostname: "Router1",
            type: "router",
        });

        // Simuliert einen Neustart der Extension: eine komplett neue Store-Instanz greift auf denselben Speicherort zu.
        const restartedStore = new TopologyStore(storageUri);
        try {
            const loaded = await restartedStore.loadTopology(created.id);
            assert.strictEqual(loaded.id, created.id);
            assert.strictEqual(loaded.devices.length, 1);
        } finally {
            restartedStore.dispose();
        }
    });

    test("Topology löschen entfernt sie aus der Liste", async () => {
        const created = await store.createTopology("Zum Löschen");
        await store.deleteTopology(created.id);

        const all = await store.listTopologies();
        assert.strictEqual(
            all.some((topology) => topology.id === created.id),
            false
        );
    });

    //Änderungserkennung

    test("Szenario 1: Gerät hinzufügen löst DeviceAdded-Event aus", async () => {
        const topology = await store.createTopology("Event-Test 1");
        const events: TopologyChangeType[] = [];
        store.onDidChangeTopology((event) => events.push(event.type));

        const device = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "Router1",
            type: "router",
        });

        assert.strictEqual(events.includes(TopologyChangeType.DeviceAdded), true);

        const reloaded = await store.loadTopology(topology.id);
        assert.strictEqual(reloaded.devices.length, 1);
        assert.strictEqual(reloaded.devices[0].id, device.id);
    });

    test("Szenario 2: Verbindung entfernen löst ConnectionRemoved-Event aus", async () => {
        const topology = await store.createTopology("Event-Test 2");
        const deviceA = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });
        const deviceB = await store.addDevice(topology.id, {
            label: "SW1",
            hostname: "SW1",
            type: "switch",
        });
        const ifaceA = await store.addInterface(
            topology.id,
            deviceA.id,
            "GigabitEthernet0/0"
        );
        const ifaceB = await store.addInterface(
            topology.id,
            deviceB.id,
            "FastEthernet0/1"
        );
        const connection = await store.addConnection(
            topology.id,
            ifaceA.id,
            ifaceB.id
        );

        const events: TopologyChangeType[] = [];
        store.onDidChangeTopology((event) => events.push(event.type));

        await store.removeConnection(topology.id, connection.id);

        assert.strictEqual(
            events.includes(TopologyChangeType.ConnectionRemoved),
            true
        );

        const reloaded = await store.loadTopology(topology.id);
        assert.strictEqual(reloaded.connections.length, 0);
    });

    test("Gerät entfernen löst DeviceRemoved-Event aus und räumt Verbindungen auf", async () => {
        const topology = await store.createTopology("Event-Test 3");
        const deviceA = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });
        const deviceB = await store.addDevice(topology.id, {
            label: "SW1",
            hostname: "SW1",
            type: "switch",
        });
        const ifaceA = await store.addInterface(topology.id, deviceA.id, "Gi0/0");
        const ifaceB = await store.addInterface(topology.id, deviceB.id, "Fa0/1");
        await store.addConnection(topology.id, ifaceA.id, ifaceB.id);

        const events: TopologyChangeType[] = [];
        store.onDidChangeTopology((event) => events.push(event.type));

        await store.removeDevice(topology.id, deviceA.id);

        assert.strictEqual(events.includes(TopologyChangeType.DeviceRemoved), true);

        const reloaded = await store.loadTopology(topology.id);
        assert.strictEqual(reloaded.devices.length, 1);
        assert.strictEqual(
            reloaded.connections.length,
            0,
            "Verbindungen zu einem entfernten Gerät müssen referenzielle Integrität wahren."
        );
    });

    //Eindeutige Zuordnung von Konfigurationsdateien

    test("Konfigurationsdatei ist genau einem Gerät eindeutig zugeordnet", async () => {
        const topology = await store.createTopology("Config-Test");
        const device = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });

        await store.setDeviceConfig(topology.id, device.id, "/configs/r1.cfg");
        const reloaded = await store.loadTopology(topology.id);

        assert.strictEqual(reloaded.devices[0].config?.filePath, "/configs/r1.cfg");
        assert.strictEqual(reloaded.devices[0].config?.deviceId, device.id);
    });

    test("Ein Interface kann nicht doppelt verbunden werden", async () => {
        const topology = await store.createTopology("Constraint-Test");
        const deviceA = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });
        const deviceB = await store.addDevice(topology.id, {
            label: "SW1",
            hostname: "SW1",
            type: "switch",
        });
        const deviceC = await store.addDevice(topology.id, {
            label: "PC1",
            hostname: "PC1",
            type: "pc",
        });
        const ifaceA = await store.addInterface(topology.id, deviceA.id, "Gi0/0");
        const ifaceB = await store.addInterface(topology.id, deviceB.id, "Fa0/1");
        const ifaceC = await store.addInterface(topology.id, deviceC.id, "eth0");

        await store.addConnection(topology.id, ifaceA.id, ifaceB.id);

        await assert.rejects(() =>
            store.addConnection(topology.id, ifaceA.id, ifaceC.id)
        );
    });

    
    // Verkabelungs- und Verbindungstests

    test("1. Eine gültige Verbindung zwischen zwei Geräten wird akzeptiert", async () => {
        const topology = await store.createTopology("Gueltige Verbindung");

        const router = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });
        const switchDevice = await store.addDevice(topology.id, {
            label: "SW1",
            hostname: "SW1",
            type: "switch",
        });

        const routerInterface = router.interfaces[0];
        const switchInterface = switchDevice.interfaces[0];

        const connection = await store.addConnection(
            topology.id,
            routerInterface.id,
            switchInterface.id
        );

        const loaded = await store.loadTopology(topology.id);

        assert.strictEqual(loaded.connections.length, 1);
        assert.strictEqual(connection.interfaceAId, routerInterface.id);
        assert.strictEqual(connection.interfaceBId, switchInterface.id);
        assert.strictEqual(loaded.connections[0].id, connection.id);
    });

    test("2. Eine Verbindung mit einem unbekannten Interface wird zurückgewiesen", async () => {
        const topology = await store.createTopology("Unbekanntes Interface");

        const router = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });
        const switchDevice = await store.addDevice(topology.id, {
            label: "SW1",
            hostname: "SW1",
            type: "switch",
        });

        await assert.rejects(
            () =>
                store.addConnection(
                    topology.id,
                    router.interfaces[0].id,
                    "unbekannte-interface-id"
                ),
            /Interfaces müssen zu einem Gerät dieser Topology gehören/
        );

        // Auch bei einer abgewiesenen Verbindung darf nichts gespeichert werden.
        const loaded = await store.loadTopology(topology.id);
        assert.strictEqual(loaded.connections.length, 0);
    });

    test("3. Eine Verbindung zwischen zwei Interfaces desselben Geräts wird zurückgewiesen", async () => {
        const topology = await store.createTopology("Gleiches Gerät");

        const router = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });

        await assert.rejects(
            () =>
                store.addConnection(
                    topology.id,
                    router.interfaces[0].id,
                    router.interfaces[1].id
                ),
            /zwei unterschiedliche Geräte verbinden/
        );

        const loaded = await store.loadTopology(topology.id);
        assert.strictEqual(loaded.connections.length, 0);
    });

    test("4. Eine Verbindung über ein bereits belegtes Interface wird zurückgewiesen", async () => {
        const topology = await store.createTopology("Belegtes Interface");

        const router = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });
        const switchDevice = await store.addDevice(topology.id, {
            label: "SW1",
            hostname: "SW1",
            type: "switch",
        });
        const pc = await store.addDevice(topology.id, {
            label: "PC1",
            hostname: "PC1",
            type: "pc",
        });

        const routerInterface = router.interfaces[0];
        const switchInterface = switchDevice.interfaces[0];
        const pcInterface = pc.interfaces[0];

        await store.addConnection(
            topology.id,
            routerInterface.id,
            switchInterface.id
        );

        await assert.rejects(
            () =>
                store.addConnection(
                    topology.id,
                    routerInterface.id,
                    pcInterface.id
                ),
            /bereits verbunden/
        );

        const loaded = await store.loadTopology(topology.id);
        assert.strictEqual(loaded.connections.length, 1);
    });

    test("5. Eine gültige Verbindung kann entfernt werden", async () => {
        const topology = await store.createTopology("Verbindung entfernen");

        const router = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });
        const switchDevice = await store.addDevice(topology.id, {
            label: "SW1",
            hostname: "SW1",
            type: "switch",
        });

        const connection = await store.addConnection(
            topology.id,
            router.interfaces[0].id,
            switchDevice.interfaces[0].id
        );

        await store.removeConnection(topology.id, connection.id);

        const loaded = await store.loadTopology(topology.id);
        assert.strictEqual(
            loaded.connections.some((item) => item.id === connection.id),
            false
        );
        assert.strictEqual(loaded.connections.length, 0);
    });

    test("6. Nach dem Entfernen einer Verbindung sind beide Interfaces wieder frei", async () => {
        const topology = await store.createTopology("Interfaces wieder frei");

        const router = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });
        const switchDevice = await store.addDevice(topology.id, {
            label: "SW1",
            hostname: "SW1",
            type: "switch",
        });
        const pc = await store.addDevice(topology.id, {
            label: "PC1",
            hostname: "PC1",
            type: "pc",
        });

        const routerInterface = router.interfaces[0];
        const switchInterface = switchDevice.interfaces[0];
        const pcInterface = pc.interfaces[0];

        const connection = await store.addConnection(
            topology.id,
            routerInterface.id,
            switchInterface.id
        );

        await store.removeConnection(topology.id, connection.id);

        // Beide zuvor belegten Interfaces müssen erneut verwendbar sein.
        const replacementConnection = await store.addConnection(
            topology.id,
            routerInterface.id,
            pcInterface.id
        );

        const loaded = await store.loadTopology(topology.id);

        assert.strictEqual(loaded.connections.length, 1);
        assert.strictEqual(
            loaded.connections[0].id,
            replacementConnection.id
        );
        assert.strictEqual(
            loaded.connections[0].interfaceAId,
            routerInterface.id
        );
        assert.strictEqual(
            loaded.connections[0].interfaceBId,
            pcInterface.id
        );

        
        // Das Switch-Interface muss ebenfalls wieder verwendbar sein.
        const secondConnection = await store.addConnection(
            topology.id,
            switchInterface.id,
            router.interfaces[1].id
        );

        const finalTopology = await store.loadTopology(topology.id);

        assert.strictEqual(finalTopology.connections.length, 2);
        assert.strictEqual(
            finalTopology.connections.some(
                (item) => item.id === secondConnection.id
            ),
            true
        );
    });

    test("7. Die automatische Interface-Ausstattung der Gerätetypen ist korrekt", async () => {
        const topology = await store.createTopology("Interface-Ausstattung");


        const router = await store.addDevice(topology.id, {
            label: "R1",
            hostname: "R1",
            type: "router",
        });
        const switchDevice = await store.addDevice(topology.id, {
            label: "SW1",
            hostname: "SW1",
            type: "switch",
        });
        const pc = await store.addDevice(topology.id, {
            label: "PC1",
            hostname: "PC1",
            type: "pc",
        });

        assert.deepStrictEqual(
            router.interfaces.map((iface) => iface.name),
            ["GigabitEthernet0/0", "GigabitEthernet0/1"]
        );

        assert.deepStrictEqual(
            switchDevice.interfaces.map((iface) => iface.name),
            Array.from(
                { length: 8 },
                (_, index) => `FastEthernet0/${index + 1}`
            )
        );

        assert.deepStrictEqual(
            pc.interfaces.map((iface) => iface.name),
            ["eth0"]
        );

        // Jedes Interface muss zum jeweiligen Gerät gehören und eine eigene ID haben.
        for (const device of [router, switchDevice, pc]) {
            assert.strictEqual(
                device.interfaces.every(
                    (iface) => iface.deviceId === device.id
                ),
                true
            );

            assert.strictEqual(
                new Set(device.interfaces.map((iface) => iface.id)).size,
                device.interfaces.length
            );
        }
    });
});