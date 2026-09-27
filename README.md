# TopoCheck

TopoCheck ist eine Visual-Studio-Code-Extension zum Lernen und Prüfen von
Netzwerkkonfigurationen. Cisco-Konfigurationsdateien mit den Endungen `.cfg`
und `.ios` werden als eigener Dateityp erkannt und während der Bearbeitung
validiert.

## Aktuelle Funktionen

- Registrierung von `.cfg`- und `.ios`-Dateien als Sprache `topocheck`
- Validierung beim Öffnen und Ändern einer Konfigurationsdatei
- manueller Befehl `TopoCheck: Validate Current Configuration`
- VS-Code-Diagnosen für ungültige oder unbekannte Befehle
- internes Datenmodell für Geräte, Interfaces, Verbindungen und Protokolle
- Topologieanalyse für fehlende Interfaces, unverbundene Geräte,
  unvollständige IP-Konfigurationen und doppelte IPv4-Adressen

Der aktuelle Konfigurationsvalidator ist bewusst ein einfacher Prototyp und
noch kein vollständiger Cisco-IOS-Parser.

## Projektstruktur

```text
src/
|-- extension.ts                 Aktivierung und VS-Code-Integration
|-- validation/
|   `-- configValidator.ts       Zeilenbasierte Konfigurationsprüfung
|-- models/                      Internes Netzwerk-Datenmodell
|-- analysis/
|   `-- topologyAnalyzer.ts      Analyse von NetworkTopology-Objekten
`-- test/                        Unit- und Integrationstests

docs/
|-- modeling/                    Planung, Regeln und Testplan für H1.c
`-- uml/
    `-- network-data-model.md    UML-Klassendiagramm
```

## Internes Datenmodell

`NetworkTopology` ist der zentrale Einstiegspunkt des Modells. Eine Topologie
enthält `NetworkDevice`- und `NetworkConnection`-Objekte. Geräte verwalten ihre
`NetworkInterface`- und `NetworkProtocol`-Objekte.

Das Modell stellt unter anderem folgende Regeln sicher:

- eindeutige Geräte-, Interface-, Protokoll- und Verbindungs-IDs
- eindeutige Interface-Namen pro Gerät
- nur unterstützte Protokolle je Gerätetyp
- Verbindungen nur zwischen vorhandenen Geräten und Interfaces
- maximal eine physische Verbindung pro Interface
- automatisches Entfernen von Verbindungen beim Löschen eines Geräts

Das vollständige Klassendiagramm befindet sich unter
[`docs/uml/network-data-model.md`](docs/uml/network-data-model.md).

## Topologieanalyse

Der Analyzer arbeitet unabhängig von der VS-Code-API und nimmt echte
`NetworkTopology`-Objekte entgegen:

```ts
const issues = analyzeTopology(topology);
```

Er liefert strukturierte `TopologyIssue`-Objekte. Dadurch kann er später vom
Parser, einem Konfigurationsgenerator oder der grafischen Oberfläche verwendet
werden. Eine direkte Verbindung zwischen `.cfg`-Dateien und dem Analyzer wird
erst mit dem geplanten Parser hergestellt.

## Entwicklung

Voraussetzungen:

- Node.js und npm
- Visual Studio Code
- die in `.vscode/extensions.json` empfohlenen Erweiterungen

Abhängigkeiten installieren:

```bash
npm install
```

Qualitätsprüfungen ausführen:

```bash
npm run check-types
npm run lint
npm test
```

Mit `F5` wird ein neues Fenster als Extension Development Host geöffnet. Dort
können die Dateien unter `test-workspace/` zum manuellen Testen verwendet
werden.

## Testdateien

- `test-workspace/valid-router.cfg` enthält eine gültige Beispielkonfiguration.
- `test-workspace/invalid-router.cfg` enthält absichtlich einen fehlenden
  Hostnamen, eine fehlende Subnetzmaske und einen unbekannten Befehl.

## Dokumentation

- [Modellierungsplanung](docs/modeling/README.md)
- [Implementierungsplan](docs/modeling/implementation-plan.md)
- [Testplan](docs/modeling/test-plan.md)
- [UML-Klassendiagramm](docs/uml/network-data-model.md)

## Bekannte Einschränkungen

- Der Konfigurationsvalidator unterstützt nur wenige grundlegende Befehle.
- Das Datenmodell unterstützt derzeit IPv4, aber noch kein IPv6.
- Der TopologieAnalyzer ist noch nicht mit dem `.cfg`-Parser oder der
  VS-Code-Diagnoseanzeige verbunden.
- Layer-3-Switches werden in der ersten Modellversion nicht gesondert behandelt.
