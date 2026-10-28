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

* Visual Studio Code 1.125.0 or later

`NetworkTopology` ist der zentrale Einstiegspunkt des Modells. Eine Topologie
enthält `NetworkDevice`- und `NetworkConnection`-Objekte. Geräte verwalten ihre
`NetworkInterface`- und `NetworkProtocol`-Objekte.

TopoCheck currently does not provide any additional VS Code settings.

Der Analyzer arbeitet unabhängig von der VS-Code-API und nimmt echte
`NetworkTopology`-Objekte entgegen:

TopoCheck is currently in development. Some planned features and networking technologies are not yet fully implemented.

## Planned Technologies

The project is planned to support networking technologies and protocols such as:

* RIP
* OSPF
* VLAN
* STP
* DHCP
* DNS
* NTP
* ACL

## Project

TopoCheck is developed as a diploma project at **HTL Wien 3 Rennweg** in Vienna, Austria.

The project focuses on creating a visual and educational environment for learning computer networking and understanding configuration errors.

## Links

* Website: https://topocheck.dev/
* Repository: https://github.com/TopoCheck/TopoCheck-Extension

## Release Notes

### 0.0.1

Initial development version of TopoCheck.

---

**TopoCheck – Understand networks. Spot errors instantly.**
