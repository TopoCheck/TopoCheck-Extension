/**
 * 
 * Kapselt die Zuständigketi: Datenmodell, Persistenz und Änderungserkennung für Topologien.
 * 
 */

import * as vscode from "vscode";
import { IModule } from "../../core/interfaces/IModule";
import { TopologyStore } from "./TopologyStore";

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
