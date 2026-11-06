# TopoCheck

TopoCheck ist eine Erweiterung für Visual Studio Code zum Erstellen grafischer
Netzwerktopologien und zum Prüfen von Cisco-IOS-Konfigurationen. Geräte,
Interfaces und unterstützte Protokolle können in einer gemeinsamen Oberfläche
konfiguriert und lokal gespeichert werden.

Das Projekt befindet sich in Entwicklung. Die aktuelle Version ist `0.0.1`.

## Funktionen

- **Grafische Topologieansicht:** Router, Switches und PCs hinzufügen,
  auswählen, verschieben, umbenennen und löschen.
- **Kabelverbindungen:** Vorhandene Interfaces zweier Geräte verbinden und
  Verbindungen wieder entfernen.
- **Gerätekonfiguration:** Name, Hostname, Domain, Benutzername,
  Zugangskennwörter und Banner im rechten Eigenschaftenpanel bearbeiten.
- **Interfaces und Protokolle:** IPv4-Adresse, Subnetzmaske, Beschreibung und
  Aktivierungszustand konfigurieren sowie passende Protokolle auswählen.
- **Interfacefilter:** Standardmäßig nur verbundene und aktivierte Interfaces
  anzeigen; über „Alle Interfaces anzeigen“ auch weitere Ports einblenden.
- **Automatische Portaktivierung:** Beim Verbinden werden die Endpunkte aktiviert,
  beim Trennen wieder deaktiviert.
- **Validierung:** Pflichtfelder, Hostnamen, IP-Adressen, Subnetzmasken und
  Protokollkompatibilität prüfen und Fehler direkt an den Feldern anzeigen.
- **Konfigurationsprüfung im Editor:** `.cfg`- und `.ios`-Dateien mit dem
  Cisco-IOS-Parser prüfen und Diagnosen unter „Probleme“ anzeigen.
- **Lokale Speicherung:** Topologien und Gerätekonfigurationen erneut öffnen;
  Geräte- und Interface-IDs sowie Kabelzuordnungen erhalten.

## Voraussetzungen

- Visual Studio Code ab Version `1.125.0`
- Node.js und npm
- Git zum Klonen und Verwalten des Repositorys

## Einrichtung und Start

Das Repository klonen und in Visual Studio Code öffnen:

```powershell
git clone https://github.com/TopoCheck/TopoCheck-Extension.git
cd TopoCheck-Extension
code .
```

Die Abhängigkeiten installieren und die Erweiterung bauen:

```powershell
npm.cmd install
npm.cmd run compile
```

Anschließend **F5** drücken und gegebenenfalls **Run Extension** auswählen.
Visual Studio Code öffnet ein separates Fenster als **Extension Development Host**,
in dem die Erweiterung getestet werden kann.

Die Beispiele verwenden `npm.cmd`, damit PowerShell nicht das möglicherweise
blockierte Skript `npm.ps1` startet. In anderen Shells kann stattdessen `npm`
verwendet werden.

## Verwendung

### Topologie erstellen und öffnen

1. Im F5-Fenster die Befehlspalette öffnen: **Strg + Umschalt + P**.
2. **TopoCheck: Create Topology** ausführen und einen Namen eingeben.
3. Geräte über die Werkzeugleiste hinzufügen und auf der Zeichenfläche platzieren.
4. Im Kabelmodus die Interfaces der zu verbindenden Geräte auswählen.
5. Eine gespeicherte Topologie über **TopoCheck: Open Topology View** erneut öffnen.

Die Befehlsnamen sind hier so angegeben, wie sie aktuell in Visual Studio Code
angezeigt werden.

### Gerät konfigurieren

Ein einfacher Klick auf ein Gerät öffnet das Eigenschaftenpanel. Vorhandene
Werte werden vorausgefüllt; Änderungen bleiben zunächst als Entwurf erhalten.

- **Speichern** prüft und übernimmt die gesamte Gerätekonfiguration.
- **Abbrechen** verwirft den Entwurf.
- Bei einem Gerätewechsel oder beim Schließen mit ungespeicherten Änderungen
  wird nachgefragt.
- Pflichtfelder sind mit `*` gekennzeichnet. IP-Adresse und Subnetzmaske sind
  gemeinsam optional und müssen zusammen angegeben oder zusammen geleert werden.

Beim Ziehen eines Geräts bleibt das Verschieben zuständig. Im Kabelmodus öffnet
ein Geräteklick die Interfaceauswahl für die Verbindung.

### Cisco-Konfiguration prüfen

1. Eine `.cfg`- oder `.ios`-Datei im F5-Fenster öffnen.
2. **TopoCheck: Validate Current Configuration** ausführen.
3. Die Diagnosen unter **Probleme** mit **Strg + Umschalt + M** ansehen.

Die Editorprüfung wird auch beim Öffnen und Ändern unterstützter Dateien
angestoßen. Beispielkonfigurationen befinden sich unter
[test-workspace](test-workspace/).

## Entwicklungsbefehle

| Befehl | Funktion |
| --- | --- |
| `npm.cmd run compile` | Typprüfung, Lint und Build der Erweiterung |
| `npm.cmd run watch` | Dateien überwachen und bei Änderungen neu bauen |
| `npm.cmd run check-types` | TypeScript-Typen von Extension und Webview prüfen |
| `npm.cmd run lint` | Code mit ESLint prüfen |
| `npm.cmd test` | Automatisierte Tests samt vorgeschalteten Buildprüfungen ausführen |
| `npm.cmd test -- --grep "H2c"` | Tests zur Gerätekonfiguration gezielt ausführen |
| `npm.cmd run inspect:device-model` | Gespeicherte Beispieldaten als H1c-Modell anzeigen |
| `npm.cmd run package` | Build für die Veröffentlichung erzeugen |

`npm.cmd run package` erstellt den Produktionsbuild; eine installierbare
`.vsix`-Datei wird durch diesen Befehl allein nicht erzeugt.

## Projektstruktur

```text
src/
  analysis/       Topologieanalyse
  commands/       VS-Code-Befehle
  core/           Modulregistrierung und Schnittstellen
  models/         Netzwerkmodell aus H1c
  modules/        Fachmodule und Topologiespeicherung
  parser/         Cisco-IOS-Parser
  shared/         Gemeinsame Typen, Nachrichten und Validierung
  validation/     Anbindung der Editorprüfung
  webview/        Grafische Oberfläche
  test/           Automatisierte Tests nach Fachbereich

docs/             Projektdokumentation und Testanleitungen
media/            Styles und Medien der Webview
images/           Projektbilder
scripts/          Entwicklungs- und Inspektionswerkzeuge
test-workspace/   Beispiele für manuelle Tests
```

Die ausführliche Ablageübersicht steht in der
[Projektdokumentation](docs/README.md).

## Dokumentation

- [Backendarchitektur](docs/architecture/README.md)
- [Gerätekonfiguration H2c](docs/device-configuration/README.md)
- [Gemeinsame Speicheroperation und Fehlerfalltests](docs/device-configuration/storage.md)
- [Dokumentationsvorlage und manueller Abnahmeplan](docs/device-configuration/documentation-guide.md)
- [Word-Dokumentation zu H2c](docs/H2c_Dokumentation.docx)
- [Cisco-IOS-Parser](docs/parser.md)
- [Planung des Netzwerkmodells](docs/modeling/README.md)
- [UML des Netzwerkmodells](docs/uml/network-data-model.md)

## Aktuelle Grenzen

- Der Parser unterstützt einen Teil der Cisco-IOS-Syntax.
- Die grafische Gerätekonfiguration verwendet derzeit IPv4.
- Das Öffnen einer `.cfg`-Datei erzeugt nicht automatisch eine grafische Topologie.
- Die Protokollauswahl umfasst Auswahl und Aktivierung; eine vollständige
  Konfigurationsoberfläche für sämtliche Protokolleinstellungen ist nicht vorhanden.
- Passwortfelder sind in der Oberfläche maskiert. Die Werte werden als Teil der
  lokalen Topologiedatei gespeichert; eine verschlüsselte Speicherung ist nicht implementiert.

## Lizenz

Die Lizenzbedingungen stehen in [LICENSE](LICENSE).
