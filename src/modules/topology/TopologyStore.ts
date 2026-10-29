import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { isFinitePoint, roundPoint } from "../../shared/geometry";
import { isHostnameTaken, nextHostname, validateHostname } from "./hostname";
import { findFreeGridPosition } from "./layout";
import { migrateTopology } from "./migrations";
import { buildConfiguredDevice, DeviceConfiguration, toNetworkDevice } from "../../shared/deviceConfiguration";
import type { NetworkDevice } from "../../models/networkDevice";
import { DeviceConfigurationValidationError } from "../../shared/validateDeviceConfiguration";
import {
    Connection,
    CURRENT_SCHEMA_VERSION,
    Device,
    DeviceConfig,
    DeviceType,
    Interface,
    Position,
    Topology,
} from "./models";

/** Arten von Änderungen auf die andere module reagieren können. */
export enum TopologyChangeType {
    TopologyCreated = "topologyCreated",
    TopologyDeleted = "topologyDeleted",
    DeviceAdded = "deviceAdded",
    DeviceRemoved = "deviceRemoved",
    DeviceUpdated = "deviceUpdated",
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

/** Änderung der Darstellung (Positionen) */
export interface LayoutChangeEvent {
    topologyId: string;
    deviceIds: string[];
}

/** Änderbare Stammdaten eines Geräts ("verwalten" in der Topologieansicht). */
export interface DeviceUpdate {
    label?: string;
    hostname?: string;
}

export interface DeviceMove {
    deviceId: string;
    position: Position;
}

export interface NewDeviceInput {
    type: DeviceType;
    /** Ohne Angabe wird automatisch R1/SW1/PC1 … vergeben. */
    hostname?: string;
    /** Ohne Angabe wird der Hostname verwendet. */
    label?: string;
    /** Ohne Angabe wird ein freier Rasterplatz gewählt. */
    position?: Position;
}

/*Verwaltung von Anlegen/Laden/Speichern/Löschen von Topologien. (CRUD)*/

export class TopologyStore implements vscode.Disposable {
    private readonly onDidChangeTopologyEmitter =
        new vscode.EventEmitter<TopologyChangeEvent>();
    readonly onDidChangeTopology = this.onDidChangeTopologyEmitter.event;

    private readonly onDidChangeLayoutEmitter =
        new vscode.EventEmitter<LayoutChangeEvent>();
    readonly onDidChangeLayout = this.onDidChangeLayoutEmitter.event;

    private readonly writeQueues = new Map<string, Promise<void>>();

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
            layout: { devices: {} },
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

        let parsed: unknown;
        try {
            parsed = JSON.parse(Buffer.from(raw).toString("utf8"));
        } catch {
            throw new Error(
                `Topology "${id}" ist beschädigt und konnte nicht gelesen werden (ungültiges JSON).`
            );
        }

        const topology = migrateTopology(parsed);

        if (this.ensureDeviceInterfaces(topology)) {
            await this.persist(topology);
        }
        const connected = new Set(topology.connections.flatMap((connection) =>
            [connection.interfaceAId, connection.interfaceBId]));
        for (const device of topology.devices) {
            for (const iface of device.interfaces) { iface.enabled ??= connected.has(iface.id); }
        }

        return topology;
    }

    /** Loads saved configuration directly into the H1c model, without a Webview/draft. */
    async loadNetworkDevice(topologyId: string, deviceId: string): Promise<NetworkDevice> {
        const topology = await this.loadTopology(topologyId);
        const device = this.findDeviceOrThrow(topology, deviceId);
        return toNetworkDevice(device, topology.devices.filter((item) => item.id !== deviceId)
            .map((item) => item.hostname));
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
        await this.withWriteLock(id, async () => {
            await vscode.workspace.fs.delete(this.fileUri(id), { useTrash: false });
        });
        this.fireChange({
            type: TopologyChangeType.TopologyDeleted,
            topologyId: id,
        });
    }

    // Geräte
    async addDevice(topologyId: string, input: NewDeviceInput): Promise<Device> {
        const device = await this.withWriteLock(topologyId, async () => {
            const topology = await this.loadTopology(topologyId);
            const existingHostnames = topology.devices.map((d) => d.hostname);

            const hostname = input.hostname ?? nextHostname(input.type, existingHostnames);
            this.assertHostnameAllowed(hostname, existingHostnames);

            const position = input.position
                ? this.normalizePosition(input.position)
                : findFreeGridPosition(Object.values(topology.layout.devices));

            
const deviceId = randomUUID();

const interfaceNames =
    input.type === "router"
        ? ["GigabitEthernet0/0", "GigabitEthernet0/1"]
        : input.type === "switch"
          ? Array.from(
                { length: 8 },
                (_, index) => `FastEthernet0/${index + 1}`
            )
          : ["eth0"];

            const newDevice: Device = {
                id: deviceId,
                topologyId,
                label: input.label ?? hostname,
                hostname,
                type: input.type,
                interfaces: interfaceNames.map((name) => ({
                    id: randomUUID(),
                    deviceId,
                    name,
                    status: "down",
                    enabled: false,
                })),
            };

            topology.devices.push(newDevice);
            topology.layout.devices[newDevice.id] = position;
            await this.persist(topology);
            return newDevice;
        });

        this.fireChange({
            type: TopologyChangeType.DeviceAdded,
            topologyId,
            deviceId: device.id,
        });

        return device;
    }

    async removeDevice(topologyId: string, deviceId: string): Promise<void> {
        await this.withWriteLock(topologyId, async () => {
            const topology = await this.loadTopology(topologyId);

            if (!topology.devices.some((device) => device.id === deviceId)) {
                throw new Error(
                    `Device "${deviceId}" existiert nicht in Topology "${topologyId}".`
                );
            }

            topology.devices = topology.devices.filter(
                (device) => device.id !== deviceId
            );
            delete topology.layout.devices[deviceId];

            // Verbindungen zu nun nicht mehr existierenden Interfaces ebenfalls entfernen.
            const remainingInterfaceIds = new Set(
                topology.devices.flatMap((device) =>
                    device.interfaces.map((iface) => iface.id)
                )
            );
            const removedConnections = topology.connections.filter((connection) =>
                !remainingInterfaceIds.has(connection.interfaceAId) || !remainingInterfaceIds.has(connection.interfaceBId));
            for (const connection of removedConnections) { this.setConnectionInterfacesEnabled(topology, connection, false); }
            topology.connections = topology.connections.filter(
                (connection) =>
                    remainingInterfaceIds.has(connection.interfaceAId) &&
                    remainingInterfaceIds.has(connection.interfaceBId)
            );

            await this.persist(topology);
        });

        this.fireChange({
            type: TopologyChangeType.DeviceRemoved,
            topologyId,
            deviceId,
        });
    }

    /** Hostname/Label ändern. Der Hostname wird nach IOS-Regeln und auf Eindeutigkeit geprüft. */
    async updateDevice(
        topologyId: string,
        deviceId: string,
        update: DeviceUpdate
    ): Promise<Device> {
        const device = await this.withWriteLock(topologyId, async () => {
            const topology = await this.loadTopology(topologyId);
            const target = this.findDeviceOrThrow(topology, deviceId);

            if (update.hostname !== undefined) {
                const otherHostnames = topology.devices
                    .filter((d) => d.id !== deviceId)
                    .map((d) => d.hostname);
                this.assertHostnameAllowed(update.hostname, otherHostnames);
                target.hostname = update.hostname;
            }
            if (update.label !== undefined) {
                const label = update.label.trim();
                if (label.length === 0) {
                    throw new Error("Die Bezeichnung darf nicht leer sein.");
                }
                target.label = label;
            }

            await this.persist(topology);
            return target;
        });

        this.fireChange({
            type: TopologyChangeType.DeviceUpdated,
            topologyId,
            deviceId,
        });

        return device;
    }

    /**
     * Verschiebt ein oder mehrere Geräte in einem Schreibvorgang.
     * Alles-oder-nichts: ist eine Angabe ungültig, wird nichts geändert.
     * Löst nur ein Layout-Event aus
     */
    async moveDevices(topologyId: string, moves: DeviceMove[]): Promise<void> {
        if (moves.length === 0) {
            return;
        }

        await this.withWriteLock(topologyId, async () => {
            const topology = await this.loadTopology(topologyId);
            const validated = moves.map((move) => {
                this.findDeviceOrThrow(topology, move.deviceId);
                return {
                    deviceId: move.deviceId,
                    position: this.normalizePosition(move.position),
                };
            });

            for (const move of validated) {
                topology.layout.devices[move.deviceId] = move.position;
            }
            await this.persist(topology);
        });

        this.onDidChangeLayoutEmitter.fire({
            topologyId,
            deviceIds: moves.map((move) => move.deviceId),
        });
    }

    /** Validate the complete draft before changing anything; keep physical link IDs/status. */
    async configureDevice(topologyId: string, deviceId: string, data: DeviceConfiguration): Promise<void> {
        await this.withWriteLock(topologyId, async () => {
            const topology = await this.loadTopology(topologyId);
            const device = this.findDeviceOrThrow(topology, deviceId);
            const model = buildConfiguredDevice(device, data, topology.devices
                .filter((item) => item.id !== deviceId).map((item) => item.hostname));
            device.hostname = model.hostname;
            device.label = data.label?.trim() ?? device.label;
            device.domainName = model.domainName;
            device.username = model.username;
            device.enableSecret = model.enableSecret;
            device.consolePassword = model.consolePassword;
            device.vtyPassword = model.vtyPassword;
            device.banner = model.banner;
            device.interfaces = device.interfaces.map((iface) => {
                const configured = model.findInterface(iface.id)!;
                return { ...iface, type: configured.type, enabled: configured.enabled,
                    ipAddress: configured.ipAddress, subnetMask: configured.subnetMask,
                    description: configured.description, layer: configured.layer };
            });
            device.protocols = model.protocols.map(({ id, type, enabled }) => ({ id, type, enabled }));
            await this.persist(topology);
        });
        this.fireChange({ type: TopologyChangeType.DeviceConfigUpdated, topologyId, deviceId });
    }

    //Interfaces
    async addInterface(
        topologyId: string,
        deviceId: string,
        name: string
    ): Promise<Interface> {
        return this.withWriteLock(topologyId, async () => {
            const topology = await this.loadTopology(topologyId);
            const device = this.findDeviceOrThrow(topology, deviceId);

            const iface: Interface = {
                id: randomUUID(),
                deviceId,
                name,
                status: "down",
                enabled: false,
            };

            device.interfaces.push(iface);
            await this.persist(topology);

            return iface;
        });
    }

    async setInterfaceStatus(
        topologyId: string,
        interfaceId: string,
        status: Interface["status"]
    ): Promise<void> {
        await this.withWriteLock(topologyId, async () => {
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
        });
    }

    //Verbindungen
    async addConnection(
        topologyId: string,
        interfaceAId: string,
        interfaceBId: string
    ): Promise<Connection> {
        if (interfaceAId === interfaceBId) {
            throw new Error("Ein Interface kann nicht mit sich selbst verbunden werden.");
        }
        const connection = await this.withWriteLock(topologyId, async () => {
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

            const deviceOfInterface = new Map(
                topology.devices.flatMap((device) =>
                    device.interfaces.map((iface) => [iface.id, device.id] as const)
                )
            );

            if (
                deviceOfInterface.get(interfaceAId) ===
                deviceOfInterface.get(interfaceBId)
            ) {
                throw new Error(
                    "Eine Verbindung muss zwei unterschiedliche Geräte verbinden."
                );
            }


            const isAlreadyConnected = topology.connections.some(
                (existing) =>
                    existing.interfaceAId === interfaceAId ||
                    existing.interfaceBId === interfaceAId ||
                    existing.interfaceAId === interfaceBId ||
                    existing.interfaceBId === interfaceBId
            );
            if (isAlreadyConnected) {
                throw new Error(
                    "Mindestens eines der beiden Interfaces ist bereits verbunden."
                );
            }

            const newConnection: Connection = {
                id: randomUUID(),
                topologyId,
                interfaceAId,
                interfaceBId,
            };

            topology.connections.push(newConnection);
            this.setConnectionInterfacesEnabled(topology, newConnection, true);
            await this.persist(topology);
            return newConnection;
        });

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
        await this.withWriteLock(topologyId, async () => {
            const topology = await this.loadTopology(topologyId);

            const removedConnection = topology.connections.find((c) => c.id === connectionId);
            if (!removedConnection) {
                throw new Error(
                    `Connection "${connectionId}" existiert nicht in Topology "${topologyId}".`
                );
            }

            topology.connections = topology.connections.filter(
                (c) => c.id !== connectionId
            );
            this.setConnectionInterfacesEnabled(topology, removedConnection, false);

            await this.persist(topology);
        });

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
        const config = await this.withWriteLock(topologyId, async () => {
            const topology = await this.loadTopology(topologyId);
            const device = this.findDeviceOrThrow(topology, deviceId);

            const newConfig: DeviceConfig = {
                id: device.config?.id ?? randomUUID(),
                deviceId,
                filePath,
                updatedAt: new Date().toISOString(),
            };

            device.config = newConfig;
            await this.persist(topology);
            return newConfig;
        });

        this.fireChange({
            type: TopologyChangeType.DeviceConfigUpdated,
            topologyId,
            deviceId,
        });

        return config;
    }

    private ensureDeviceInterfaces(topology: Topology): boolean {
        let changed = false;

        for (const device of topology.devices) {
            if (device.interfaces.length > 0) {
                continue;
            }

            const names =
                device.type === "router"
                    ? ["GigabitEthernet0/0", "GigabitEthernet0/1"]
                    : device.type === "switch"
                    ? Array.from(
                            { length: 8 },
                            (_, index) => `FastEthernet0/${index + 1}`
                        )
                    : ["eth0"];

            device.interfaces = names.map((name) => ({
                id: randomUUID(),
                deviceId: device.id,
                name,
                status: "down",
                enabled: false,
            }));

            changed = true;
        }

        return changed;
    }

    private setConnectionInterfacesEnabled(topology: Topology, connection: Connection, enabled: boolean): void {
        for (const device of topology.devices) {
            for (const iface of device.interfaces) {
                if (iface.id === connection.interfaceAId || iface.id === connection.interfaceBId) { iface.enabled = enabled; }
            }
        }
    }

    //Intern

    /**
     * Führt "task" erst aus, wenn alle vorher angemeldeten Schreibvorgänge derselben
     * Topologie abgeschlossen sind (egal ob erfolgreich oder mit Fehler).
     */
    private withWriteLock<T>(topologyId: string, task: () => Promise<T>): Promise<T> {
        const previous = this.writeQueues.get(topologyId) ?? Promise.resolve();
        const result = previous.then(task);
        // Fehler dürfen die Kette nicht blockieren – der Aufrufer bekommt sie über "result".
        const tail = result.then(
            () => undefined,
            () => undefined
        );
        this.writeQueues.set(topologyId, tail);
        void tail.then(() => {
            if (this.writeQueues.get(topologyId) === tail) {
                this.writeQueues.delete(topologyId);
            }
        });
        return result;
    }

    private normalizePosition(position: Position): Position {
        if (!isFinitePoint(position)) {
            throw new Error("Ungültige Position: x und y müssen endliche Zahlen sein.");
        }
        return roundPoint(position);
    }

    private assertHostnameAllowed(hostname: string, otherHostnames: string[]): void {
        const error = validateHostname(hostname);
        if (error) {
            throw new Error(error);
        }
        if (isHostnameTaken(hostname, otherHostnames)) {
            throw new Error(`Der Hostname "${hostname}" ist in dieser Topologie bereits vergeben.`);
        }
    }

    private findDeviceOrThrow(topology: Topology, deviceId: string): Device {
        const device = topology.devices.find((d) => d.id === deviceId);
        if (!device) {
            throw new DeviceConfigurationValidationError([{
                field: "deviceId", code: "device-not-found",
                message: `Device "${deviceId}" existiert nicht in Topology "${topology.id}".`
            }]);
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
        this.onDidChangeLayoutEmitter.dispose();
    }
}
