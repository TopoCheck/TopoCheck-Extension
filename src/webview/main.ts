/**
 * Einstiegspunkt der Topologieansicht (läuft im Browser-Kontext der Webview).
 */

import type { ExtensionToWebviewMessage } from "../shared/protocol";
import { TopologyEditor } from "./editor";
import { installIconSprite } from "./icons";
import { Minimap } from "./minimap";
import { vscodeApi } from "./vscodeApi";

function main(): void {
    const root = document.getElementById("app");
    const topologyId = document.body.dataset.topologyId;
    if (!root || !topologyId) {
        return;
    }

    installIconSprite();
    const editor = new TopologyEditor(root, topologyId);
    new Minimap(editor, editor.corner);

    editor.savePersistedState({ topologyId });

    window.addEventListener("message", (event: MessageEvent<ExtensionToWebviewMessage>) => {
        editor.receive(event.data);
    });
    vscodeApi.postMessage({ type: "ready" });
}

main();
