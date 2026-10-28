import * as vscode from "vscode";
import { validateConfiguration } from "./validation/configValidator";
import { registerParserPreview } from "./commands/previewParser";
import { DeviceType } from "./models";

import { ModuleRegistry } from "./core/ModuleRegistry";
import { TopologyModule } from "./modules/topology/TopologyModule";
import { ConfigModule } from "./modules/config/ConfigModule";
import { DiagnosticsModule } from "./modules/diagnostics/DiagnosticsModule";
import { ExternalApiModule } from "./modules/external-api/ExternalApiModule";
import { ExampleModule } from "./example-module/ExampleModule";

export function activate(context: vscode.ExtensionContext): void {
  const registry = new ModuleRegistry();

  const topologyModule = new TopologyModule(context);

  registry.register(topologyModule);
  registry.register(new ConfigModule());
  registry.register(new DiagnosticsModule());
  registry.register(new ExternalApiModule());
  registry.register(new ExampleModule());

  registry.initializeAll();

  context.subscriptions.push(topologyModule);

  const deviceTypes = new Map<string, DeviceType>();
  const diagnostics =
    vscode.languages.createDiagnosticCollection("topocheck");

  context.subscriptions.push(diagnostics);

  function validateDocument(document: vscode.TextDocument): void {
    if (document.languageId !== "topocheck" && !/\.(cfg|ios)$/i.test(document.fileName)) {
      return;
    }

    diagnostics.set(
      document.uri,
      validateConfiguration(document, {
        deviceId: document.uri.toString(),
        deviceType: deviceTypes.get(document.uri.toString()) ?? DeviceType.Router
      })
    );
  }

  registerParserPreview(context, (document, type) => {
    deviceTypes.set(document.uri.toString(), type);
    validateDocument(document);
  });

  const validateCommand = vscode.commands.registerCommand(
    "topocheck.validate",
    async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showWarningMessage(
          "TopoCheck: Keine Konfigurationsdatei geöffnet."
        );
        return;
      }

      if (editor.document.languageId !== "topocheck" && !/\.(cfg|ios)$/i.test(editor.document.fileName)) {
        await vscode.window.showWarningMessage("TopoCheck: Öffne eine .cfg- oder .ios-Datei.");
        return;
      }
      const selection = await vscode.window.showQuickPick([
        { label: "Router", type: DeviceType.Router },
        { label: "Switch", type: DeviceType.Switch }
      ], { title: "TopoCheck: Gerätetyp für die Validierung" });
      if (!selection || editor.document.isClosed) {
        return;
      }
      deviceTypes.set(editor.document.uri.toString(), selection.type);

      validateDocument(editor.document);

      vscode.window.showInformationMessage(
        "TopoCheck: Parser-Prüfung abgeschlossen. Meldungen stehen unter Probleme."
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
    (document) => {
      diagnostics.delete(document.uri);
      deviceTypes.delete(document.uri.toString());
    }
  );

  for (const document of vscode.workspace.textDocuments) {
    validateDocument(document);
  }

  context.subscriptions.push(
    validateCommand,
    openListener,
    changeListener,
    closeListener
  );
}

export function deactivate(): void { }
