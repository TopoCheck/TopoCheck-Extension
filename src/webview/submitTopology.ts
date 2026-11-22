/**
 * Schaltfläche "Topologie absenden" in der Werkzeugleiste.
 * Der Benutzer entscheidet bewusst zwischen generieren lassen und selbst schreiben.
 */

import type { ExtensionToWebviewMessage } from "../shared/protocol";
import { vscodeApi } from "./vscodeApi";

const OPTIONS = [
    {
        mode: "generate", title: "Konfiguration generieren",
        text: "TopoCheck erzeugt die Konfiguration aus deiner Topologie. Gut als Musterlösung."
    },
    {
        mode: "write", title: "Selbst schreiben",
        text: "Du bekommst je Gerät eine leere Datei. Fehler werden beim Schreiben markiert und erklärt."
    }
] as const;

export class SubmitTopologyMenu {
    private readonly trigger = document.createElement("button");
    private readonly menu = document.createElement("div");

    constructor(root: HTMLElement) {
        this.trigger.type = "button";
        this.trigger.className = "submit-topology";
        this.trigger.textContent = "Topologie absenden";
        this.trigger.setAttribute("aria-haspopup", "menu");
        this.trigger.setAttribute("aria-expanded", "false");
        this.trigger.disabled = true;

        this.menu.className = "submit-topology-menu";
        this.menu.setAttribute("role", "menu");
        this.menu.hidden = true;
        for (const option of OPTIONS) {
            const item = document.createElement("button");
            item.type = "button";
            item.setAttribute("role", "menuitem");
            const title = document.createElement("strong"); title.textContent = option.title;
            const text = document.createElement("span"); text.textContent = option.text;
            item.append(title, text);
            item.addEventListener("click", () => {
                this.toggle(false);
                vscodeApi.postMessage({ type: "submitTopology", mode: option.mode });
            });
            this.menu.append(item);
        }

        this.trigger.addEventListener("click", () => this.toggle(this.menu.hidden !== false));
        // Tastatureingaben nicht an die Zeichenfläche (Entf, F2 …) durchreichen.
        this.menu.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") { this.toggle(false); this.trigger.focus(); }
        });
        document.addEventListener("pointerdown", (event) => {
            if (!this.menu.hidden && !this.menu.contains(event.target as Node) && event.target !== this.trigger) { this.toggle(false); }
        });

        const wrapper = document.createElement("div");
        wrapper.className = "submit-topology-wrapper";
        wrapper.append(this.trigger, this.menu);
        const toolbar = root.querySelector(".toolbar");
        toolbar?.append(wrapper);
    }

    receive(message: ExtensionToWebviewMessage): void {
        if (message.type !== "state") { return; }
        // Ohne Router oder Switch gibt es nichts zu konfigurieren.
        const configurable = message.topology.devices.some((device) => device.type !== "pc");
        this.trigger.disabled = !configurable;
        this.trigger.title = configurable ? "" : "Zuerst mindestens einen Router oder Switch hinzufügen.";
        if (!configurable) { this.toggle(false); }
    }

    private toggle(open: boolean): void {
        this.menu.hidden = !open;
        this.trigger.setAttribute("aria-expanded", String(open));
        if (open) { this.menu.querySelector("button")?.focus(); }
    }
}
