import * as assert from "assert";
import { DeviceType } from "../../models";
import { parseCiscoConfig } from "../../parser";
import { formatParserPreview } from "../../parser/parserPreview";

suite("Parser preview", () => {
  test("shows actual model collections and protocol settings", () => {
    const result = parseCiscoConfig("hostname R1\ninterface Loopback0\nrouter ospf 1\n router-id 10.0.0.1",
      { deviceId: "r1", deviceType: DeviceType.Router });
    const preview = formatParserPreview("router.cfg", result);
    assert.match(preview, /Erfolgreich geparst/);
    const data = JSON.parse(preview.split("H1c-Datenmodell:\n")[1]);
    assert.strictEqual(data.interfaces[0].name, "Loopback0");
    assert.strictEqual(data.protocols[0].processes[0].routerId, "10.0.0.1");
  });
  test("distinguishes warnings, partial data and missing devices", () => {
    const options = { deviceId: "r1", deviceType: DeviceType.Router };
    assert.match(formatParserPreview("r.cfg", parseCiscoConfig("hostname R1\nunknown", options)), /Ergebnis mit Warnungen/);
    const partial = formatParserPreview("r.cfg", parseCiscoConfig("hostname R1\ninterface Loopback0\n ip address bad mask", options));
    assert.match(partial, /Teilergebnis mit Fehlern/);
    assert.match(partial, /Zeile 3 \[error\]/);
    assert.match(formatParserPreview("r.cfg", parseCiscoConfig("", options)), /Kein Gerät erstellt/);
  });
});
