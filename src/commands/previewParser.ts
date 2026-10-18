import * as vscode from "vscode";
import { DeviceType } from "../models";
import { parseCiscoConfig } from "../parser";
import { formatParserPreview } from "../parser/parserPreview";

/** Manual H1e test entry point; deliberately independent of editor validation. */
export function registerParserPreview(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("TopoCheck Parser");
  const command = vscode.commands.registerCommand("topocheck.previewParser", async () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || (document.languageId !== "topocheck" && !/\.(cfg|ios)$/i.test(document.fileName))) {
      await vscode.window.showWarningMessage("TopoCheck: Öffne zuerst eine .cfg- oder .ios-Datei.");
      return;
    }
    // Capture the current editor contents before the asynchronous picker opens.
    const text = document.getText();
    const source = document.uri.toString();
    const selection = await vscode.window.showQuickPick([
      { label: "Router", deviceType: DeviceType.Router },
      { label: "Switch", deviceType: DeviceType.Switch }
    ], { title: "TopoCheck: Gerätetyp für den Parser-Test", placeHolder: "Gerätetyp wählen" });
    if (!selection) {
      return;
    }
    const result = parseCiscoConfig(text, { deviceId: source, deviceType: selection.deviceType });
    output.clear();
    output.appendLine(formatParserPreview(source, result));
    output.show(true);
  });
  context.subscriptions.push(output, command);
}
