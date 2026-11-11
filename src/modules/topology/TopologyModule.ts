/**
 *
 * Kapselt die Zuständigkeit: Datenmodell, Persistenz und Änderungserkennung für Topologien
 *
 */

import * as vscode from "vscode";
import { IModule } from "../../core/interfaces/IModule";
import { TOPOLOGY_VIEW_TYPE, TopologyViewState } from "../../shared/protocol";
import { TopologyStore } from "./TopologyStore";
import { TopologyViewPanel } from "./view/TopologyViewPanel";
import { ConfigModule } from "../config/ConfigModule";

/** Gespeicherte Topologie-IDs sind UUIDs – alles andere wird nicht als Dateiname verwendet. */
const TOPOLOGY_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

interface DeviceContextArgs {
    deviceId?: unknown;
}

export class TopologyModule implements IModule, vscode.Disposable {
    readonly name = "topology";

    private _store: TopologyStore | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    private configModule: ConfigModule | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext
    ) { }

    setConfigModule(configModule: ConfigModule): void {
        this.configModule = configModule;
    }

    private get config(): ConfigModule {
        if (!this.configModule) {
            throw new Error("ConfigModule wurde noch nicht initialisiert.");
        }

        return this.configModule;
    }

    // Öffentlicher Zugriff auf den Store für andere Module
    get store(): TopologyStore {
        if (!this._store) {
            throw new Error(
                "TopologyModule wurde noch nicht initialisiert – initialize() muss zuerst über die ModuleRegistry aufgerufen werden."
            );
        }
        return this._store;
    }

    initialize(): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        if (!workspaceFolder) {
            void vscode.window.showErrorMessage(
                "TopoCheck: Bitte öffne zuerst einen Projektordner in VS Code."
            );
            return;
        }

        const storageUri = vscode.Uri.joinPath(
            workspaceFolder.uri,
            "topologies"
        );

        this._store = new TopologyStore(storageUri);
        this.disposables.push(this._store);

        this.registerCommands();
        this.registerViewCommands();
        this.registerSerializer();
    }

    async openTopologyView(topologyId: string): Promise<void> {
        await TopologyViewPanel.show(
            this.context.extensionUri,
            this.store,
            this.config,
            topologyId
        );
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

        this.disposables.push(createCommand, openCommand);
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

                TopologyViewPanel.revive(
                    panel,
                    this.context.extensionUri,
                    this.store,
                    this.config,
                    topologyId
                );
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