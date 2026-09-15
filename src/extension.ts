import * as vscode from "vscode";
import { validateConfiguration } from "./validation/configValidator";

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics =
    vscode.languages.createDiagnosticCollection("topocheck");

  context.subscriptions.push(diagnostics);

  function validateDocument(document: vscode.TextDocument): void {
    if (document.languageId !== "topocheck") {
      return;
    }

    diagnostics.set(
      document.uri,
      validateConfiguration(document)
    );
  }

  const validateCommand = vscode.commands.registerCommand(
    "topocheck.validate",
    () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showWarningMessage(
          "TopoCheck: Keine Konfigurationsdatei geöffnet."
        );
        return;
      }

      validateDocument(editor.document);

      vscode.window.showInformationMessage(
        "TopoCheck: Konfiguration wurde geprüft."
      );
    }
  );

  const openListener = vscode.workspace.onDidOpenTextDocument(
    validateDocument
  );

  const changeListener =
    vscode.workspace.onDidChangeTextDocument((event) => {
      validateDocument(event.document);
    });

  const closeListener = vscode.workspace.onDidCloseTextDocument(
    (document) => diagnostics.delete(document.uri)
  );

  if (vscode.window.activeTextEditor) {
    validateDocument(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    validateCommand,
    openListener,
    changeListener,
    closeListener
  );
}

export function deactivate(): void {}
