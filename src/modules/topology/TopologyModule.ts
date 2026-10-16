/**
 *
 * Kapselt die Zuständigketi: Datenmodell, Persistenz und Änderungserkennung für Topologien
 * sowie die interaktive Topologieansicht
 *
 */

import * as vscode from "vscode";
import { IModule } from "../../core/interfaces/IModule";
import { TOPOLOGY_VIEW_TYPE, TopologyViewState } from "../../shared/protocol";
import { buildDemoPlan, demoInterfaceName } from "./demo";
import { Device } from "./models";
import { TopologyStore } from "./TopologyStore";
import { TopologyViewPanel } from "./view/TopologyViewPanel";

/** Gespeicherte Topologie-IDs sind UUIDs – alles andere wird nicht als Dateiname verwendet. */
const TOPOLOGY_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

interface DeviceContextArgs {
    deviceId?: unknown;
}

export class TopologyModule implements IModule, vscode.Disposable {
    readonly name = "topology";

    private _store: TopologyStore | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext) { }

    //Öffentlicher Zugriff auf den Store für andere Module
    get store(): TopologyStore {
        if (!this._store) {
            throw new Error(
                "TopologyModule wurde noch nicht initialisiert – initialize() muss zuerst über die ModuleRegistry aufgerufen werden."
            );
        }
        return this._store;
    }

    initialize(): void {
        const storageUri = vscode.Uri.joinPath(
            this.context.globalStorageUri,
            "topologies"
        );
        this._store = new TopologyStore(storageUri);
        this.disposables.push(this._store);

        this.registerCommands();
        this.registerViewCommands();
        this.registerSerializer();
    }

    async openTopologyView(topologyId: string): Promise<void> {
        await TopologyViewPanel.show(this.context.extensionUri, this.store, topologyId);
    }

    private registerCommands(): void {
        const createCommand = vscode.commands.registerCommand(
            "topocheck.topology.create",
            async () => {
                const name = await vscode.window.showInputBox({
                    prompt: "Name der neuen Topologie",
                });
                if (!name) {
                    return;
                }

                const topology = await this.store.createTopology(name);
                await this.openTopologyView(topology.id);
            }
        );

        const openCommand = vscode.commands.registerCommand(
            "topocheck.topology.open",
            async () => {
                const topologies = await this.store.listTopologies();
                topologies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

                const createItem: vscode.QuickPickItem = {
                    label: "$(add) Neue Topologie erstellen …",
                    alwaysShow: true,
                };
                const items: (vscode.QuickPickItem & { id?: string })[] = [
                    createItem,
                    ...topologies.map((topology) => ({
                        label: topology.name,
                        description: `${topology.devices.length} Geräte`,
                        detail: `Zuletzt geändert: ${new Date(topology.updatedAt).toLocaleString("de-AT")}`,
                        id: topology.id,
                    })),
                ];

                const picked = await vscode.window.showQuickPick(items, {
                    title: "TopoCheck: Topologie öffnen",
                    placeHolder: "Topologie auswählen",
                });
                if (!picked) {
                    return;
                }
                if (picked === createItem || !picked.id) {
                    await vscode.commands.executeCommand("topocheck.topology.create");
                    return;
                }
                await this.openTopologyView(picked.id);
            }
        );

        const demoCommand = vscode.commands.registerCommand(
            "topocheck.topology.createDemo",
            () => this.createDemoTopology()
        );

        this.disposables.push(createCommand, openCommand, demoCommand);
    }

    private async createDemoTopology(): Promise<void> {
        const input = await vscode.window.showInputBox({
            title: "TopoCheck: Demo-Topologie erzeugen",
            prompt: "Anzahl der Geräte (1–500)",
            value: "50",
            validateInput: (value) => {
                const count = Number(value);
                return Number.isInteger(count) && count >= 1 && count <= 500
                    ? undefined
                    : "Bitte eine ganze Zahl zwischen 1 und 500 eingeben.";
            },
        });
        if (!input) {
            return;
        }
        const count = Number(input);
        const plan = buildDemoPlan(count);

        const topology = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Demo-Topologie mit ${count} Geräten wird erzeugt …`,
            },
            async () => {
                const created = await this.store.createTopology(`Demo (${count} Geräte)`);
                const devices: Device[] = [];
                for (const planned of plan.devices) {
                    devices.push(
                        await this.store.addDevice(created.id, {
                            type: planned.type,
                            position: planned.position,
                        })
                    );
                }

                const interfaceCount = new Map<string, number>();
                const nextInterface = async (index: number) => {
                    const device = devices[index];
                    const used = interfaceCount.get(device.id) ?? 0;
                    interfaceCount.set(device.id, used + 1);
                    return this.store.addInterface(
                        created.id,
                        device.id,
                        demoInterfaceName(device.type, used)
                    );
                };
                for (const [a, b] of plan.links) {
                    const ifaceA = await nextInterface(a);
                    const ifaceB = await nextInterface(b);
                    await this.store.addConnection(created.id, ifaceA.id, ifaceB.id);
                }
                return created;
            }
        );

        await this.openTopologyView(topology.id);
    }

    private registerViewCommands(): void {
        const withDevice =
            (action: (panel: TopologyViewPanel, deviceId: string) => Promise<void>) =>
                async (args?: DeviceContextArgs) => {
                    const panel = TopologyViewPanel.active;
                    if (!panel || typeof args?.deviceId !== "string") {
                        return;
                    }
                    try {
                        await action(panel, args.deviceId);
                    } catch (error) {
                        const text = error instanceof Error ? error.message : String(error);
                        void vscode.window.showErrorMessage(`TopoCheck: ${text}`);
                    }
                };

        this.disposables.push(
            vscode.commands.registerCommand(
                "topocheck.topologyView.renameDevice",
                withDevice((panel, id) => panel.renameDevice(id))
            ),
            vscode.commands.registerCommand(
                "topocheck.topologyView.deleteDevice",
                withDevice((panel, id) => panel.deleteDevice(id))
            ),
            vscode.commands.registerCommand(
                "topocheck.topologyView.configureDevice",
                withDevice((panel, id) => panel.openDevice(id))
            )
        );
    }

    private registerSerializer(): void {
        const serializer: vscode.WebviewPanelSerializer<TopologyViewState> = {
            deserializeWebviewPanel: async (panel, state) => {
                const topologyId = state?.topologyId;
                if (typeof topologyId !== "string" || !TOPOLOGY_ID_PATTERN.test(topologyId)) {
                    panel.dispose();
                    return;
                }
                try {
                    await this.store.loadTopology(topologyId);
                } catch {
                    // Topologie wurde inzwischen gelöscht.
                    panel.dispose();
                    return;
                }
                TopologyViewPanel.revive(panel, this.context.extensionUri, this.store, topologyId);
            },
        };

        this.disposables.push(
            vscode.window.registerWebviewPanelSerializer(TOPOLOGY_VIEW_TYPE, serializer)
        );
    }

    dispose(): void {
        TopologyViewPanel.disposeAll();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
