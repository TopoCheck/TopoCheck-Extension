/**
 * "Topologie absenden": legt je Gerät eine Konfigurationsdatei im Arbeitsbereich an.
 *   generate – TopoCheck erzeugt die Konfiguration (derzeit Switching aus H3b)
 *   write    – leere Vorlage, der Benutzer schreibt selbst; geprüft wird im Editor
 */

import * as vscode from "vscode";
import { generateSwitchingConfigurations, switchingInputFromTopology } from "../../generator/switching";
import type { Device, Topology } from "../topology/models";
import type { TopologyStore } from "../topology/TopologyStore";

export type SubmissionMode = "generate" | "write";

const output = vscode.window.createOutputChannel("TopoCheck");

export async function submitTopology(store: TopologyStore, topologyId: string, mode: SubmissionMode): Promise<void> {
    const topology = await store.loadTopology(topologyId);
    const folder = await targetFolder(topology);
    if (!folder) { return; }

    const files = mode === "generate" ? generatedFiles(topology) : templateFiles(topology);
    if (!files.length) {
        void vscode.window.showWarningMessage("TopoCheck: Die Topologie enthält keine Geräte, für die eine Konfiguration erstellt werden kann.");
        return;
    }

    // Eigene Arbeit des Benutzers wird nie ungefragt überschrieben.
    const existing = await existingFiles(folder, files.map((file) => file.name));
    if (mode === "generate" && existing.length) {
        const overwrite = "Überschreiben";
        const answer = await vscode.window.showWarningMessage(
            `${existing.length} Konfigurationsdatei(en) existieren bereits.`,
            { modal: true, detail: existing.join(", ") }, overwrite);
        if (answer !== overwrite) { return; }
    }

    await vscode.workspace.fs.createDirectory(folder);
    for (const file of files) {
        const uri = vscode.Uri.joinPath(folder, file.name);
        if (mode === "write" && existing.includes(file.name)) { continue; }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content, "utf8"));
        await store.setDeviceConfig(topologyId, file.device.id, uri.fsPath);
    }

    const first = vscode.Uri.joinPath(folder, files[0].name);
    await vscode.window.showTextDocument(first, { viewColumn: vscode.ViewColumn.One, preview: false });
    void vscode.window.showInformationMessage(mode === "generate"
        ? `TopoCheck: Switching-Konfiguration für ${files.length} Switch(es) erzeugt.`
        : `TopoCheck: ${files.length} Vorlage(n) angelegt – Fehler werden beim Schreiben markiert.`);
}

function generatedFiles(topology: Topology) {
    const { input, warnings: adapterWarnings } = switchingInputFromTopology(topology);
    const { configs, warnings } = generateSwitchingConfigurations(input);
    reportWarnings(topology, [...adapterWarnings, ...warnings]);
    return configs.map((config) => {
        const device = topology.devices.find((item) => item.id === config.deviceId)!;
        // hostname vorerst hier, bis die Grundkonfiguration (H3c) zusammengeführt wird; der Parser benötigt ihn.
        return { device, name: fileName(device), content: `hostname ${device.hostname}\n!\n${config.config}` };
    });
}

function templateFiles(topology: Topology) {
    return topology.devices
        .filter((device) => device.type !== "pc")
        .map((device) => ({
            device, name: fileName(device),
            content: `! ${device.hostname} – eigene Konfiguration\nhostname ${device.hostname}\n!\n`
        }));
}

function reportWarnings(topology: Topology, warnings: { code: string; message: string }[]): void {
    output.clear();
    output.appendLine(`Switching-Generator – ${topology.name} (${new Date().toLocaleString("de-AT")})`);
    if (!warnings.length) { output.appendLine("Keine Hinweise."); return; }
    for (const warning of warnings) { output.appendLine(`[${warning.code}] ${warning.message}`); }
    output.show(true);
}

async function targetFolder(topology: Topology): Promise<vscode.Uri | undefined> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
        void vscode.window.showErrorMessage("TopoCheck: Bitte zuerst einen Ordner öffnen – dort werden die Konfigurationsdateien abgelegt.");
        return undefined;
    }
    return vscode.Uri.joinPath(workspace.uri, "topocheck", safeName(topology.name));
}

async function existingFiles(folder: vscode.Uri, names: string[]): Promise<string[]> {
    const found: string[] = [];
    for (const name of names) {
        try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, name)); found.push(name); }
        catch { /* Datei existiert nicht */ }
    }
    return found;
}

function fileName(device: Device): string { return `${safeName(device.hostname)}.cfg`; }

function safeName(name: string): string {
    return name.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "") || "topologie";
}
