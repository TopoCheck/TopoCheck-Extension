/**
 * 
 * Kapselt die Zuständigketi: Datenmodell, Persistenz und Änderungserkennung für Topologien.
 * 
 */

import * as vscode from "vscode";
import { TopologyStore } from "./TopologyStore";

export class TopologyModule implements vscode.Disposable {
    readonly store: TopologyStore;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(context: vscode.ExtensionContext) {
        const storageUri = vscode.Uri.joinPath(
            context.globalStorageUri,
            "topologies"
        );
        this.store = new TopologyStore(storageUri);
        this.disposables.push(this.store);
        this.registerCommands();
    }

    private registerCommands(): void {
        const createCommand = vscode.commands.registerCommand(
            "topocheck.topology.create",
            async () => {
                const name = await vscode.window.showInputBox({
                    prompt: "Name der neuen Topologie:",
                });
                if (!name) {
                    return;
                }

                const topology = await this.store.createTopology(name);
                vscode.window.showInformationMessage(
                    `TopoCheck: Topologie "${topology.name}" wurde angelegt (${topology.id}).`
                );
            }
        );
        this.disposables.push(createCommand);
    }
    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}