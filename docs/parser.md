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

Noch nicht umgesetzt: Dateizugriffe, Editor-Anbindung, DHCP-Adressen und sekundäre
IP-Adressen. Banner-Inhalte werden übersprungen und nicht modelliert. Der bisherige Editor-Validator bleibt
unverändert. Das abschließende Review für die gesamte H1e-Aufgabe steht noch aus.

## VLANs, Switchports und Routing

Die spezifischen H1c-Protokollklassen in `src/models/ciscoProtocols.ts` erben von
`NetworkProtocol` und bleiben über `device.protocols` zugänglich. Mit
`instanceof VlanProtocol`, `StaticRouteProtocol` oder `OspfProtocol` können
Konsumenten auf die typisierten Einstellungen zugreifen. Pro Gerät existiert
weiterhin höchstens ein Objekt je Protokolltyp. Mehrere OSPF-Prozesse werden in
`OspfProtocol.processes` zusammengefasst.

| Bereich | Unterstützte Syntax und Daten |
|---|---|
| VLANs | `vlan <1-4094>`, darunter `name <Name>` (ein Wort, höchstens 32 Zeichen) |
| Switchports | `switchport`, `no switchport`, `switchport mode access/trunk`, `switchport access vlan <ID>`, `switchport trunk native vlan <ID>` |
| Trunk-Liste | `switchport trunk allowed vlan <Liste/all/none>` sowie `add`, `remove`, `except` mit ID-Liste; Listen enthalten IDs und Bereiche wie `10,20-22` |
| Statische Routen | `ip route <Netz> <Maske> <Next-Hop und/oder Ausgangsinterface> [Distanz]`; Distanz 1–255, auch `Null0` |
| OSPF | `router ospf <1-65535>`, darunter `router-id <IPv4>`, `network <IPv4> <Wildcard> area <Area>`, `[no] passive-interface <Interface/default>` |

Switchport-Daten liegen in `NetworkInterface.switchport`. Eine fehlende
`allowedVlans`-Liste bedeutet alle VLANs, eine leere Liste keine VLANs. Andere
nicht gesetzte Switchport-Felder bleiben unbekannt; der Parser ergänzt keine
geräteabhängigen Default-Werte. VLAN-Zuordnungen erfordern keine explizite
VLAN-Definition in derselben Datei. `no switchport` entfernt die gespeicherten
Switchport-Einstellungen; ein eigener Zustand für einen gerouteten Port wird
aktuell nicht modelliert.

Statische Routenziele müssen Netzadressen mit zusammenhängender Maske sein.
OSPF unterstützt zusammenhängende Wildcard-Masken und Areas als Dezimalzahl
(0–4294967295) oder IPv4-Schreibweise. Areas werden als dezimale Strings
normalisiert. Passive-Interface-Vorgabe und explizite Ausnahmen werden getrennt
gespeichert. Wiederholte identische Routen und OSPF-Netzwerke werden dedupliziert;
erneute VLAN-/Prozessblöcke aktualisieren bestehende Objekte.

Die H1c-Kompatibilitätsregeln gelten weiterhin: VLANs und Switchports nur für
Switches, statische Routen und OSPF nur für Router. Inkompatible Konfigurationen
erzeugen Fehlerdiagnosen statt Exceptions. Layer-3-Switches benötigen eine
spätere Erweiterung dieser Modellregel.

Nicht unterstützt werden insbesondere Interface-/VLAN-Bereiche als Blockheader,
abgekürzte Interface-Namen, dynamische Switchport-Modi, VRFs, IPv6,
Route-Optionen wie `track`/`name`/`tag`, OSPF-Authentifizierung, OSPF-Aktivierung
direkt am Interface sowie weitere `no`-Befehle zum Löschen von VLANs, Routen
oder OSPF-Einstellungen. Nicht unterstützte Befehle bleiben als Diagnosen
sichtbar und werden nicht stillschweigend in das Modell übernommen.

Fünf gültige Testdateien liegen unter `src/test/parser/fixtures` und werden in
Unit-Tests mit konkreten erwarteten Werten geprüft: Basisrouter, VLAN-Switch,
Trunk-Switch, Router mit statischen Routen und Router mit zwei OSPF-Prozessen.

```powershell
npm.cmd run compile-tests
node node_modules/mocha/bin/mocha.js --ui tdd "out/test/parser/**/*.test.js"
```

## Validierung und Fehlerbehandlung

Jede zeilenbezogene Diagnose enthält `line` (ab 1), `severity`, `message` und
`command` (getrimmte Quellzeile). Bei ungültigen Aufrufargumenten kann `command`
fehlen. Leere Konfigurationen und ungültige Laufzeitargumente des Einzelparsers
werden als Fehler zurückgegeben. Meldungen unterscheiden ungültige unterstützte
Syntax (`error`) und unbekannte bzw. nicht unterstützte Befehle (`warning`).
OSPF-Unterbefehle außerhalb ihres Abschnitts erzeugen Kontextfehler.

Nach einem Fehler wird die nächste Zeile verarbeitet. Eine ungültige neue
IP-Konfiguration, Router-ID, VLAN-Liste oder Route überschreibt keine zuvor
gültigen Werte. Ungültige Abschnittsheader verwerfen den aktuellen Kontext,
damit ihre Unterbefehle nicht versehentlich zum vorherigen Abschnitt gehören.
Beim nächsten gültigen Abschnitt kann die Verarbeitung wieder regulär fortfahren.

`banner <Typ> <Trennzeichen>` wird als nicht modellierter Abschnitt gemeldet;
der Inhalt wird bis zum nächsten Trennzeichen übersprungen. Unterstützt werden
einzelne Trennzeichen und die Textdarstellung `^C` bzw. ähnliche Caret-Paare.
Ohne abschließendes Trennzeichen wird an der Startzeile ein Fehler gemeldet.
In diesem Fall bleibt der Rest der Datei Banner-Inhalt und wird nicht als
Konfiguration interpretiert. Einzeilige Banner werden ebenfalls übersprungen.

Die Dateien `invalid-values.cfg` und `unknown-syntax.cfg` prüfen die
Fehlerfortsetzung mit echten Konfigurationstexten. Weitere Tests decken leere
Eingaben, ungültige Aufrufargumente, fehlerhafte Header, Kontextfehler,
nicht abgeschlossene Banner und wechselnde Kombinationen fehlerhafter Befehle ab.

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
