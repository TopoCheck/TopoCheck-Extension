/**
 * Einstiegspunkt der Topologieansicht (läuft im Browser-Kontext der Webview).
 */

import type { ExtensionToWebviewMessage } from "../shared/protocol";
import { TopologyEditor } from "./editor";
import { installIconSprite } from "./icons";
import { Minimap } from "./minimap";
import { vscodeApi } from "./vscodeApi";
import { DeviceConfigurationForm } from "./deviceConfigurationForm";
import { SubmitTopologyMenu } from "./submitTopology";

function main(): void {
    const root = document.getElementById("app");
    const topologyId = document.body.dataset.topologyId;
    if (!root || !topologyId) {
        return;
    }

    installIconSprite();
    const editor = new TopologyEditor(root, topologyId);
    const configurationForm = new DeviceConfigurationForm(root, {
        initialWidth: editor.persistedState.configurationWidth,
        saveWidth: (width) => editor.savePersistedState({ configurationWidth: width })
    });
    const submitMenu = new SubmitTopologyMenu(root);
    new Minimap(editor, editor.corner);

    editor.savePersistedState({ topologyId });

    window.addEventListener("message", (event: MessageEvent<ExtensionToWebviewMessage>) => {
        editor.receive(event.data);
        configurationForm.receive(event.data);
        submitMenu.receive(event.data);
    });
    vscodeApi.postMessage({ type: "ready" });
}

main();
