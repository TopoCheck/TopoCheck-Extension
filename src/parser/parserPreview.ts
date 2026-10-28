import { CiscoIosParseResult } from "./ciscoIosParser";

/** Human-readable preview, including public model collections and partial-result status. */
export function formatParserPreview(source: string, result: CiscoIosParseResult): string {
  const errors = result.diagnostics.filter((item) => item.severity === "error").length;
  const warnings = result.diagnostics.length - errors;
  const device = result.device;
  const status = !device ? "Kein Gerät erstellt" : errors ? "Teilergebnis mit Fehlern" :
    warnings ? "Ergebnis mit Warnungen; nicht unterstützte Angaben können fehlen" : "Erfolgreich geparst";
  return [
    `Datei: ${source}`, `Status: ${status}`, `Fehler: ${errors}; Warnungen: ${warnings}`,
    "", "Diagnosen:",
    ...result.diagnostics.map((item) =>
      `Zeile ${item.line} [${item.severity}]: ${item.message}`),
    ...(result.diagnostics.length ? [] : ["Keine Diagnosen."]),
    "", "H1c-Datenmodell:",
    device ? JSON.stringify({
      id: device.id, hostname: device.hostname, type: device.type,
      interfaces: device.interfaces, protocols: device.protocols
    }, null, 2) : "Kein Gerät verfügbar."
  ].join("\n");
}
