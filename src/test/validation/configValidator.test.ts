import * as assert from "assert";
import * as vscode from "vscode";
import { DeviceType } from "../../models";
import { parseCiscoConfig } from "../../parser";
import { validateConfiguration } from "../../validation/configValidator";

suite("Parser editor diagnostics", () => {
  test("accepts abbreviations in the editor without obsolete regex errors", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "topocheck", content: "h R1\nint gi0/0\n ip add 192.0.2.1 255.255.255.0\n no shut"
    });
    assert.deepStrictEqual(validateConfiguration(document), []);
  });

  test("maps parser messages, one-based lines and severities exactly", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "topocheck", content: "hostname R1\ninterface Loopback0\n ip address bad mask\n unknown"
    });
    const options = { deviceId: document.uri.toString(), deviceType: DeviceType.Router };
    const expected = parseCiscoConfig(document.getText(), options).diagnostics;
    const actual = validateConfiguration(document, options);
    assert.strictEqual(actual.length, expected.length);
    actual.forEach((diagnostic, index) => {
      assert.strictEqual(diagnostic.message, expected[index].message);
      assert.strictEqual(diagnostic.range.start.line, expected[index].line - 1);
      assert.strictEqual(diagnostic.severity, expected[index].severity === "error" ?
        vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      assert.strictEqual(diagnostic.source, "TopoCheck Parser");
    });
  });

  test("uses the selected device type for switching configuration", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "topocheck", content: "h SW1\nvl 10\n na Clients\n!\nint fa0/1\n sw mo acc\n sw acc vl 10"
    });
    assert.deepStrictEqual(validateConfiguration(document, {
      deviceId: "sw1", deviceType: DeviceType.Switch
    }), []);
    assert.ok(validateConfiguration(document).some((item) => item.severity === vscode.DiagnosticSeverity.Error));
  });
});
