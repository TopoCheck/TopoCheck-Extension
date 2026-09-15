import * as vscode from "vscode";

const hostnamePattern = /^hostname\s+[A-Za-z0-9_-]+$/;
const interfacePattern = /^interface\s+.+$/;
const ipAddressPattern =
  /^ip address\s+(?:\d{1,3}\.){3}\d{1,3}\s+(?:\d{1,3}\.){3}\d{1,3}$/;

export function validateConfiguration(
  document: vscode.TextDocument
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    const line = document.lineAt(lineNumber);
    const text = line.text.trim();

    if (
      text === "" ||
      text.startsWith("!") ||
      text === "configure terminal" ||
      text === "exit" ||
      text === "end" ||
      text === "no shutdown"
    ) {
      continue;
    }

    let errorMessage: string | undefined;

    if (text.startsWith("hostname") && !hostnamePattern.test(text)) {
      errorMessage = "Nach 'hostname' muss ein gültiger Name stehen.";
    } else if (text.startsWith("interface") && !interfacePattern.test(text)) {
      errorMessage = "Nach 'interface' muss eine Schnittstelle stehen.";
    } else if (text.startsWith("ip address") && !ipAddressPattern.test(text)) {
      errorMessage =
        "Erwartet: ip address <IPv4-Adresse> <Subnetzmaske>";
    } else if (
      !text.startsWith("hostname") &&
      !text.startsWith("interface") &&
      !text.startsWith("ip address")
    ) {
      errorMessage = `Unbekannter Befehl: ${text}`;
    }

    if (errorMessage) {
      const diagnostic = new vscode.Diagnostic(
        line.range,
        errorMessage,
        vscode.DiagnosticSeverity.Error
      );

      diagnostic.source = "TopoCheck";
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}
