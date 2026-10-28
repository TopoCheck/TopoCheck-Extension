import * as vscode from "vscode";
import { DeviceType } from "../models";
import { parseCiscoConfig } from "../parser";
import { formatParserPreview } from "../parser/parserPreview";

/** Manual parser preview using the same device selection as editor diagnostics. */
export function registerParserPreview(context: vscode.ExtensionContext,
  onDeviceTypeSelected: (document: vscode.TextDocument, type: DeviceType) => void): void {
  const output = vscode.window.createOutputChannel("TopoCheck Parser");
  const command = vscode.commands.registerCommand("topocheck.previewParser", async () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || (document.languageId !== "topocheck" && !/\.(cfg|ios)$/i.test(document.fileName))) {
      await vscode.window.showWarningMessage("TopoCheck: Öffne zuerst eine .cfg- oder .ios-Datei.");
      return;
    }
    const source = document.uri.toString();
    const selection = await vscode.window.showQuickPick([
      { label: "Router", deviceType: DeviceType.Router },
      { label: "Switch", deviceType: DeviceType.Switch }
    ], { title: "TopoCheck: Gerätetyp für den Parser-Test", placeHolder: "Gerätetyp wählen" });
    if (!selection) {
      return;
    }
    if (document.isClosed) {
      return;
    }
    onDeviceTypeSelected(document, selection.deviceType);
    const result = parseCiscoConfig(document.getText(), { deviceId: source, deviceType: selection.deviceType });
    output.clear();
    output.appendLine(formatParserPreview(source, result));
    output.show(true);
  });
  context.subscriptions.push(output, command);
}
