# Cisco-IOS-Parser – erster Schritt von H1e

`src/parser` exportiert `parseCiscoConfig(text, options)`. Der Aufrufer übergibt
eine stabile `deviceId` und den bekannten `deviceType`. Das Ergebnis enthält
`device` (H1c-`NetworkDevice`) und `diagnostics` mit einsbasierten Zeilennummern,
Schweregrad und Meldung. Ohne gültigen Hostnamen entsteht kein Gerät.

```typescript
import { parseCiscoConfig } from "./parser";
import { DeviceType } from "./models";

const result = parseCiscoConfig(configurationText, {
  deviceId: "router-1",
  deviceType: DeviceType.Router
});
```

Unterstützt: `hostname`, `interface`, `description`, `no description`,
statische IPv4-Adressen mit zusammenhängender Subnetzmaske (`ip address`),
`no ip address`, `shutdown`, `no shutdown`. Interface-Kategorien:
Ethernet, FastEthernet, GigabitEthernet, Loopback und Vlan.
`!`, `exit` und `configure terminal` beenden den Interface-Kontext;
`end` beendet die Verarbeitung. Erneute Blöcke desselben Interfaces aktualisieren
dessen Werte. Fehlende Zustände verwenden die H1c-Vorgabe (`enabled: true`),
keine gerätespezifischen Defaults.

Unbekannte Befehle und Abschnitte erzeugen Warnungen. Fehlerhafte unterstützte
Befehle erzeugen Fehler; gültige vorherige Werte bleiben erhalten. Auch bei
vorhandenem Gerät müssen Aufrufer die Diagnosen prüfen, da Teilergebnisse
möglich sind. Die Schnittstelle ist unabhängig von VS Code.

Noch nicht umgesetzt: Dateizugriffe, Editor-Anbindung, VLAN-Definitionen,
Switchports, Routingprotokolle, statische Routen, DHCP-Adressen, sekundäre
IP-Adressen und mehrzeilige Banner. Der bisherige Editor-Validator bleibt
unverändert. Die fünf vollständigen Testkonfigurationsdateien und das
abschließende Review für die gesamte H1e-Aufgabe stehen noch aus.

## Anbindung an H1c

`parseCiscoTopology(configurations, topologyData)` fasst mehrere Konfigurationen
direkt zu einer H1c-`NetworkTopology` zusammen:

```typescript
import { parseCiscoTopology } from "./parser";
import { DeviceType } from "./models";
import { analyzeTopology } from "./analysis/topologyAnalyzer";

const result = parseCiscoTopology([
  { text: configurationText, deviceId: "router-1", deviceType: DeviceType.Router }
], { id: "actual", name: "Ist-Konfiguration" });

if (result.topology) {
  const issues = analyzeTopology(result.topology);
}
```

Die Geräte-ID stammt vom Aufrufer und muss für Soll und Ist gleich sein.
Interface-IDs entstehen als `<deviceId>:<interfaceName>` und bleiben bei
Änderungen von Hostname, IP-Adresse oder Zustand stabil. Eine bestehende
Soll-Topologie mit anders vergebenen Interface-IDs muss Interfaces über ihre
Namen zuordnen oder dieselbe ID-Konvention verwenden. Es entsteht kein zweites
Geräte- oder Interface-Modell und keine vorhandene Soll-Topologie wird verändert.

Parserfehler oder doppelte Geräte-IDs verhindern die Rückgabe einer Topologie.
Diagnosen enthalten zusätzlich die Geräte-ID zur Zuordnung zur Eingabedatei.
Warnungen bleiben sichtbar: Eine zurückgegebene Topologie kann nicht unterstützte
Konfigurationsteile auslassen. Der spätere Vergleich muss diese Einschränkung
berücksichtigen. Ungültige Topologie-Metadaten sind Aufruferfehler und werden
wie im H1c-Modell durch eine Exception gemeldet. Eine leere Eingabeliste liefert
eine leere Topologie.

Physische Verbindungen werden nicht aus IP-Adressen oder Beschreibungen geraten.
Sie können über `NetworkTopology.addConnection` aus einer separaten Quelle
ergänzt werden. Der Integrationstest prüft diesen Weg und die direkte Verwendung
des Parser-Ergebnisses durch `analyzeTopology`. Ein eigentlicher Soll-Ist-Vergleich
und die Editor-Anbindung sind nicht Teil dieser Anbindung.
