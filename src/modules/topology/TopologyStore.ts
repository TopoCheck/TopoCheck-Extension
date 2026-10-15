import * as vscode from "vscode";
import { randomUUID } from "crypto";
import {
    Connection,
    CURRENT_SCHEMA_VERSION,
    Device,
    DeviceConfig,
    DeviceType,
    Interface,
    Topology,
} from "./models";

/** Arten von Änderungen auf die andere module reagieren können. */
export enum TopologyChangeType {
    TopologyCreated = "topologyCreated",
    TopologyDeleted = "topologyDeleted",
    DeviceAdded = "deviceAdded",
    DeviceRemoved = "deviceRemoved",
    ConnectionAdded = "connectionAdded",
    ConnectionRemoved = "connectionRemoved",
    DeviceConfigUpdated = "deviceConfigUpdated",
}

export interface TopologyChangeEvent {
    type: TopologyChangeType;
    topologyId: string;
    deviceId?: string;
    connectionId?: string;
}

/*Verwaltung von Anlegen/Laden/Speichern/Löschen von Topologien. (CRUD)*/

export class TopologyStore implements vscode.Disposable {
    private readonly onDidChangeTopologyEmitter =
        new vscode.EventEmitter<TopologyChangeEvent>();
    readonly onDidChangeTopology = this.onDidChangeTopologyEmitter.event;

    constructor(private readonly storageUri: vscode.Uri) { }

    async createTopology(name: string): Promise<Topology> {
        const now = new Date().toISOString();
        const topology: Topology = {
            id: randomUUID(),
            name,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            createdAt: now,
            updatedAt: now,
            devices: [],
            connections: [],
        };

        await this.persist(topology);
        this.fireChange({
            type: TopologyChangeType.TopologyCreated,
            topologyId: topology.id,
        });

        return topology;
    }

    async loadTopology(id: string): Promise<Topology> {
        let raw: Uint8Array;

        try {
            raw = await vscode.workspace.fs.readFile(this.fileUri(id));
        } catch {
            throw new Error(
                `Topology "${id}" konnte nicht geladen werden: Datei nicht gefunden.`
            );
        }

        try {
            return JSON.parse(Buffer.from(raw).toString("utf8")) as Topology;
        } catch {
            throw new Error(
                `Topology "${id}" ist beschädigt und konnte nicht gelesen werden (ungültiges JSON).`
            );
        }
    }

    async listTopologies(): Promise<Topology[]> {
        await this.ensureStorageDir();

        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(this.storageUri);
        } catch {
            return [];
        }

        const topologies: Topology[] = [];
        for (const [fileName, fileType] of entries) {
            const isTopologyFile =
                fileType === vscode.FileType.File && fileName.endsWith(".json");
            if (!isTopologyFile) {
                continue;
            }

            const id = fileName.slice(0, -".json".length);
            try {
                topologies.push(await this.loadTopology(id));
            } catch {
                // Einzelne beschädigte Datei überspringen statt die gesamte Liste scheitern zu lassen.
            }
        }

        return topologies;
    }

    async deleteTopology(id: string): Promise<void> {
        await vscode.workspace.fs.delete(this.fileUri(id), { useTrash: false });
        this.fireChange({
            type: TopologyChangeType.TopologyDeleted,
            topologyId: id,
        });
    }

    // Geräte
    async addDevice(
        topologyId: string,
        input: { label: string; hostname: string; type: DeviceType }
    ): Promise<Device> {
        const topology = await this.loadTopology(topologyId);

        const device: Device = {
            id: randomUUID(),
            topologyId,
            label: input.label,
            hostname: input.hostname,
            type: input.type,
            interfaces: [],
        };

        topology.devices.push(device);
        await this.persist(topology);
        this.fireChange({
            type: TopologyChangeType.DeviceAdded,
            topologyId,
            deviceId: device.id,
        });

        return device;
    }

    async removeDevice(topologyId: string, deviceId: string): Promise<void> {
        const topology = await this.loadTopology(topologyId);

        if (!topology.devices.some((device) => device.id === deviceId)) {
            throw new Error(
                `Device "${deviceId}" existiert nicht in Topology "${topologyId}".`
            );
        }

        topology.devices = topology.devices.filter(
            (device) => device.id !== deviceId
        );

        // Verbindungen zu nun nicht mehr existierenden Interfaces ebenfalls entfernen.
        const remainingInterfaceIds = new Set(
            topology.devices.flatMap((device) =>
                device.interfaces.map((iface) => iface.id)
            )
        );
        topology.connections = topology.connections.filter(
            (connection) =>
                remainingInterfaceIds.has(connection.interfaceAId) &&
                remainingInterfaceIds.has(connection.interfaceBId)
        );

        await this.persist(topology);
        this.fireChange({
            type: TopologyChangeType.DeviceRemoved,
            topologyId,
            deviceId,
        });
    }

    //Interfaces
    async addInterface(
        topologyId: string,
        deviceId: string,
        name: string
    ): Promise<Interface> {
        const topology = await this.loadTopology(topologyId);
        const device = this.findDeviceOrThrow(topology, deviceId);

        const iface: Interface = {
            id: randomUUID(),
            deviceId,
            name,
            status: "down",
        };

        device.interfaces.push(iface);
        await this.persist(topology);

        return iface;
    }

    async setInterfaceStatus(
        topologyId: string,
        interfaceId: string,
        status: Interface["status"]
    ): Promise<void> {
        const topology = await this.loadTopology(topologyId);

        for (const device of topology.devices) {
            const iface = device.interfaces.find((i) => i.id === interfaceId);
            if (iface) {
                iface.status = status;
                await this.persist(topology);
                return;
            }
        }

        throw new Error(
            `Interface "${interfaceId}" existiert nicht in Topology "${topologyId}".`
        );
    }

    //Verbindungen
    async addConnection(
        topologyId: string,
        interfaceAId: string,
        interfaceBId: string
    ): Promise<Connection> {
        const topology = await this.loadTopology(topologyId);

        const allInterfaceIds = new Set(
            topology.devices.flatMap((device) =>
                device.interfaces.map((iface) => iface.id)
            )
        );
        if (!allInterfaceIds.has(interfaceAId) || !allInterfaceIds.has(interfaceBId)) {
            throw new Error(
                "Beide Interfaces müssen zu einem Gerät dieser Topology gehören."
            );
        }

        const isAlreadyConnected = topology.connections.some(
            (connection) =>
                connection.interfaceAId === interfaceAId ||
                connection.interfaceBId === interfaceAId ||
                connection.interfaceAId === interfaceBId ||
                connection.interfaceBId === interfaceBId
        );
        if (isAlreadyConnected) {
            throw new Error(
                "Mindestens eines der beiden Interfaces ist bereits verbunden."
            );
        }

        const connection: Connection = {
            id: randomUUID(),
            topologyId,
            interfaceAId,
            interfaceBId,
        };

        topology.connections.push(connection);
        await this.persist(topology);
        this.fireChange({
            type: TopologyChangeType.ConnectionAdded,
            topologyId,
            connectionId: connection.id,
        });

        return connection;
    }

    async removeConnection(
        topologyId: string,
        connectionId: string
    ): Promise<void> {
        const topology = await this.loadTopology(topologyId);

        if (!topology.connections.some((c) => c.id === connectionId)) {
            throw new Error(
                `Connection "${connectionId}" existiert nicht in Topology "${topologyId}".`
            );
        }

        topology.connections = topology.connections.filter(
            (c) => c.id !== connectionId
        );

        await this.persist(topology);
        this.fireChange({
            type: TopologyChangeType.ConnectionRemoved,
            topologyId,
            connectionId,
        });
    }

    //Device Config Zuordnung
    async setDeviceConfig(
        topologyId: string,
        deviceId: string,
        filePath: string
    ): Promise<DeviceConfig> {
        const topology = await this.loadTopology(topologyId);
        const device = this.findDeviceOrThrow(topology, deviceId);

        const config: DeviceConfig = {
            id: device.config?.id ?? randomUUID(),
            deviceId,
            filePath,
            updatedAt: new Date().toISOString(),
        };

        device.config = config;
        await this.persist(topology);
        this.fireChange({
            type: TopologyChangeType.DeviceConfigUpdated,
            topologyId,
            deviceId,
        });

        return config;
    }

    //Intern
    private findDeviceOrThrow(topology: Topology, deviceId: string): Device {
        const device = topology.devices.find((d) => d.id === deviceId);
        if (!device) {
            throw new Error(
                `Device "${deviceId}" existiert nicht in Topology "${topology.id}".`
            );
        }
        return device;
    }

    private fileUri(id: string): vscode.Uri {
        return vscode.Uri.joinPath(this.storageUri, `${id}.json`);
    }

    private tempFileUri(id: string): vscode.Uri {
        return vscode.Uri.joinPath(this.storageUri, `${id}.json.tmp`);
    }

    private async ensureStorageDir(): Promise<void> {
        await vscode.workspace.fs.createDirectory(this.storageUri);
    }

    private async persist(topology: Topology): Promise<void> {
        await this.ensureStorageDir();
        topology.updatedAt = new Date().toISOString();

        const encoded = Buffer.from(JSON.stringify(topology, null, 2), "utf8");
        const tempUri = this.tempFileUri(topology.id);
        const finalUri = this.fileUri(topology.id);

        // write-then-rename: verhindert, dass ein Absturz mitten im Schreiben eine bereits gespeicherte, gültige Topology-Datei zerstört.
        await vscode.workspace.fs.writeFile(tempUri, encoded);
        await vscode.workspace.fs.rename(tempUri, finalUri, { overwrite: true });
    }

    private fireChange(event: TopologyChangeEvent): void {
        this.onDidChangeTopologyEmitter.fire(event);
    }

    dispose(): void {
        this.onDidChangeTopologyEmitter.dispose();
    }
}
