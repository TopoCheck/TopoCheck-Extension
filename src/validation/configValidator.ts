import * as vscode from "vscode";
import { DeviceType } from "../models";
import { CiscoIosParserOptions, parseCiscoConfig } from "../parser";

/** VS Code adapter only: all syntax and value validation belongs to the parser. */
export function validateConfiguration(
  document: vscode.TextDocument,
  options: CiscoIosParserOptions = { deviceId: document.uri.toString(), deviceType: DeviceType.Router }
): vscode.Diagnostic[] {
  return parseCiscoConfig(document.getText(), options).diagnostics.map((item) => {
    const lineIndex = Math.max(0, Math.min(item.line - 1, document.lineCount - 1));
    const diagnostic = new vscode.Diagnostic(
      document.lineAt(lineIndex).range,
      item.message,
      item.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = "TopoCheck Parser";
    return diagnostic;
  });
}
