/**
 * Interaktive Topologieansicht als WebviewPanel neben dem Editor
 *
 * Verantwortungen:
 *  - Webview erzeugen (HTML, Content-Security-Policy, Ressourcen)
 *  - Nachrichten der Webview prüfen und an den TopologyStore weitergeben
 *  - bei jeder Store-Änderung den aktuellen Zustand an die Webview senden
 */

import * as vscode from "vscode";
import { randomBytes } from "crypto";
import {
    ExtensionToWebviewMessage,
    TOPOLOGY_VIEW_TYPE,
    WebviewToExtensionMessage,
} from "../../../shared/protocol";
import { isHostnameTaken, validateHostname } from "../hostname";
import { Topology } from "../models";
import { TopologyChangeType, TopologyStore } from "../TopologyStore";
import { parseWebviewMessage } from "./parseWebviewMessage";
import { ConfigurationFieldError, DeviceConfigurationValidationError } from "../../../shared/validateDeviceConfiguration";

export class TopologyViewPanel implements vscode.Disposable {
    /** Höchstens eine Ansicht pro Topologie. */
    private static readonly panels = new Map<string, TopologyViewPanel>();
    private static lastActive: TopologyViewPanel | undefined;

    private readonly disposables: vscode.Disposable[] = [];
    private refreshScheduled = false;
    private discardPendingOnNextState = false;
    private disposed = false;

    static async show(
        extensionUri: vscode.Uri,
        store: TopologyStore,
        topologyId: string
    ): Promise<TopologyViewPanel> {
        const existing = TopologyViewPanel.panels.get(topologyId);
        if (existing) {
            existing.panel.reveal();
            return existing;
        }

        const topology = await store.loadTopology(topologyId);
        const panel = vscode.window.createWebviewPanel(
            TOPOLOGY_VIEW_TYPE,
            TopologyViewPanel.titleFor(topology),
            // Neben dem Editor: links Skript, rechts Topologie.
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
            TopologyViewPanel.webviewOptions(extensionUri)
        );
        return new TopologyViewPanel(panel, extensionUri, store, topologyId);
    }

    /** Wiederherstellen nach einem Neustart von VS Code (WebviewPanelSerializer). */
    static revive(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        store: TopologyStore,
        topologyId: string
    ): TopologyViewPanel {
        panel.webview.options = TopologyViewPanel.webviewOptions(extensionUri);
        return new TopologyViewPanel(panel, extensionUri, store, topologyId);
    }

    /** Die zuletzt aktive Ansicht – Ziel der Kontextmenü-Befehle. */
    static get active(): TopologyViewPanel | undefined {
        return TopologyViewPanel.lastActive;
    }

    static disposeAll(): void {
        for (const panel of [...TopologyViewPanel.panels.values()]) {
            panel.dispose();
        }
    }

    private static webviewOptions(extensionUri: vscode.Uri): vscode.WebviewPanelOptions & vscode.WebviewOptions {
        return {
            enableScripts: true,
            // Nur diese beiden Ordner dürfen von der Webview geladen werden.
            localResourceRoots: [
                vscode.Uri.joinPath(extensionUri, "dist"),
                vscode.Uri.joinPath(extensionUri, "media"),
            ],
        };
    }

    private static titleFor(topology: Topology): string {
        return `Topologie: ${topology.name}`;
    }

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly extensionUri: vscode.Uri,
        private readonly store: TopologyStore,
        readonly topologyId: string
    ) {
        TopologyViewPanel.panels.set(topologyId, this);
        TopologyViewPanel.lastActive = this;

        panel.webview.html = this.renderHtml();
        panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "topology.svg");

        this.disposables.push(
            panel.onDidDispose(() => this.dispose()),
            panel.onDidChangeViewState((event) => {
                if (event.webviewPanel.active) {
                    TopologyViewPanel.lastActive = this;
                }
            }),
            panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw)),
            store.onDidChangeTopology((event) => {
                if (event.topologyId !== topologyId) {
                    return;
                }
                if (event.type === TopologyChangeType.TopologyDeleted) {
                    this.dispose();
                    return;
                }
                this.scheduleRefresh();
            }),
            store.onDidChangeLayout((event) => {
                if (event.topologyId === topologyId) {
                    this.scheduleRefresh();
                }
            })
        );
    }

    // Aktionen (auch von Kontextmenü-Befehlen genutzt)

    async renameDevice(deviceId: string): Promise<void> {
        const topology = await this.store.loadTopology(this.topologyId);
        const device = topology.devices.find((d) => d.id === deviceId);
        if (!device) {
            return;
        }
        const otherHostnames = topology.devices
            .filter((d) => d.id !== deviceId)
            .map((d) => d.hostname);

        // Nativer VS-Code-Eingabedialog mit Live-Prüfung (gleiche Regeln wie im Store).
        const hostname = await vscode.window.showInputBox({
            title: `Gerät umbenennen (${device.hostname})`,
            prompt: "Neuer Hostname (wird auch in der generierten Konfiguration verwendet)",
            value: device.hostname,
            validateInput: (value) =>
                validateHostname(value) ??
                (isHostnameTaken(value, otherHostnames)
                    ? `"${value}" ist in dieser Topologie bereits vergeben.`
                    : undefined),
        });
        if (hostname === undefined || hostname === device.hostname) {
            return;
        }

        await this.store.updateDevice(this.topologyId, deviceId, {
            hostname,
            label: hostname,
        });
    }

    async deleteDevice(deviceId: string): Promise<void> {
        const topology = await this.store.loadTopology(this.topologyId);
        const device = topology.devices.find((d) => d.id === deviceId);
        if (!device) {
            return;
        }

        // Rückfrage nur, wenn mehr verloren geht als sichtbar ist
        const interfaceIds = new Set(device.interfaces.map((iface) => iface.id));
        const affectedConnections = topology.connections.filter(
            (c) => interfaceIds.has(c.interfaceAId) || interfaceIds.has(c.interfaceBId)
        ).length;

        if (affectedConnections > 0) {
            const confirm = "Löschen";
            const answer = await vscode.window.showWarningMessage(
                `"${device.hostname}" löschen?`,
                {
                    modal: true,
                    detail: `Dabei ${affectedConnections === 1 ? "wird auch 1 Verbindung" : `werden auch ${affectedConnections} Verbindungen`} entfernt.`,
                },
                confirm
            );
            if (answer !== confirm) {
                return;
            }
        }

        await this.store.removeDevice(this.topologyId, deviceId);
    }

    async openDevice(deviceId: string): Promise<void> {
        const topology = await this.store.loadTopology(this.topologyId);
        const device = topology.devices.find((d) => d.id === deviceId);
        if (!device) {
            return;
        }
        await this.panel.webview.postMessage({ type: "editDevice", device,
            connectedInterfaceIds: topology.connections.flatMap((connection) => [connection.interfaceAId, connection.interfaceBId]),
            otherHostnames: topology.devices.filter((item) => item.id !== deviceId)
                .map((item) => item.hostname) } satisfies ExtensionToWebviewMessage);
    }

    // Kommunikation

    private async onMessage(raw: unknown): Promise<void> {
        const message = parseWebviewMessage(raw);
        if (!message) {
            console.warn("TopoCheck: ungültige Nachricht aus der Topologieansicht verworfen.");
            return;
        }

        try {
            await this.handle(message);
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`TopoCheck: ${text}`);
            // Optimistische Änderungen der Webview zurücknehmen.
            this.discardPendingOnNextState = true;
            this.scheduleRefresh();
        }
    }

    private async handle(message: WebviewToExtensionMessage): Promise<void> {
        switch (message.type) {
            case "configureDevice": {
                let error: string | undefined;
                let validationErrors: ConfigurationFieldError[] | undefined;
                try {
                    await this.store.configureDevice(this.topologyId, message.deviceId, message.configuration);
                } catch (cause) {
                    error = cause instanceof Error ? cause.message : String(cause);
                    if (cause instanceof DeviceConfigurationValidationError) { validationErrors = cause.errors; }
                }
                await this.panel.webview.postMessage({ type: "configurationResult",
                    deviceId: message.deviceId, error, validationErrors } satisfies ExtensionToWebviewMessage);
                return;
            }
            case "ready":
                await this.postState();
                return;
            case "addDevice":
                await this.store.addDevice(this.topologyId, {
                    type: message.deviceType,
                    position: message.position,
                });
                return;
            case "moveDevices":
                await this.store.moveDevices(this.topologyId, message.moves);
                return;
            case "deleteDevice":
                await this.deleteDevice(message.deviceId);
                return;
            case "renameDevice":
                await this.renameDevice(message.deviceId);
                return;
            case "openDevice":
                await this.openDevice(message.deviceId);
                return;
            
            case "addConnection":
                await this.store.addConnection(
                    this.topologyId,
                    message.interfaceAId,
                    message.interfaceBId
                );
                return;

            case "removeConnection":
                await this.store.removeConnection(
                    this.topologyId,
                    message.connectionId
                );
                return;
        }
    }

    /**
     * Mehrere Store-Events kurz hintereinander (z. B. beim Erzeugen einer Demo-Topologie)
     * werden zu einer Zustandsnachricht zusammengefasst.
     */
    private scheduleRefresh(): void {
        if (this.refreshScheduled || this.disposed) {
            return;
        }
        this.refreshScheduled = true;
        setTimeout(() => {
            this.refreshScheduled = false;
            void this.postState();
        }, 0);
    }

    private async postState(): Promise<void> {
        if (this.disposed) {
            return;
        }
        let topology: Topology;
        try {
            topology = await this.store.loadTopology(this.topologyId);
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`TopoCheck: ${text}`);
            return;
        }

        this.panel.title = TopologyViewPanel.titleFor(topology);
        const message: ExtensionToWebviewMessage = {
            type: "state",
            topology,
            discardPendingChanges: this.discardPendingOnNextState,
        };
        this.discardPendingOnNextState = false;
        await this.panel.webview.postMessage(message);
    }

    // HTML

    private renderHtml(): string {
        const webview = this.panel.webview;
        const nonce = randomBytes(16).toString("base64");
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "media", "topologyView.css")
        );

        // Strenge CSP: keine Inline-Skripte, nur eigenes Bundle mit Nonce
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource}`,
            `img-src ${webview.cspSource} data:`,
            `font-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
        ].join("; ");

        return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${styleUri}">
    <title>Topologie</title>
</head>
<body data-topology-id="${this.topologyId}">
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        TopologyViewPanel.panels.delete(this.topologyId);
        if (TopologyViewPanel.lastActive === this) {
            TopologyViewPanel.lastActive = undefined;
        }
        this.panel.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
