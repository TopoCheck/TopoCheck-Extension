/**
 * Typisierter Zugriff auf die VS-Code-API innerhalb der Webview.
 */

import type { TopologyViewState, WebviewToExtensionMessage } from "../shared/protocol";

interface VsCodeApi {
    postMessage(message: WebviewToExtensionMessage): void;
    getState(): TopologyViewState | undefined;
    setState(state: TopologyViewState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** Darf laut VS Code nur einmal pro Webview aufgerufen werden. */
export const vscodeApi: VsCodeApi = acquireVsCodeApi();
