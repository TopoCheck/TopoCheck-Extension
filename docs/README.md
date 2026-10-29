# Projektdokumentation

## Einstieg

- [Backendarchitektur](architecture/README.md)
- [Übersicht der Module](architecture/modules.md)
- [Gerätekonfiguration H2c](device-configuration/README.md)
- [Gemeinsame Speicheroperation](device-configuration/storage.md)
- [Dokumentationsvorlage und Abnahmeplan](device-configuration/documentation-guide.md)
- [Word Dokumentation für H2c](H2c_Dokumentation.docx)
- [Cisco IOS Parser](parser.md)
- [Planung des Netzwerkmodells](modeling/README.md)
- [Implementierungsplan des Netzwerkmodells](modeling/implementation-plan.md)
- [Testplan des Netzwerkmodells](modeling/test-plan.md)
- [UML des Netzwerkmodells](uml/network-data-model.md)

## Ablage

```text
docs/
  architecture/            Backendarchitektur und Modulübersicht
  device-configuration/    Bedienung, Speicherung und Abnahme für H2c
  modeling/                Planung und Tests des H1c-Modells
  uml/                     Modelldiagramme
  parser.md                Parserdokumentation
  H2c_Dokumentation.docx   Word-Ausgabe der H2c-Dokumentation

src/
  analysis/                Topologieanalyse
  commands/                VS-Code-Befehle
  core/                    Modulregistrierung und gemeinsame Schnittstellen
  example-module/          Beispiel für die Modulregistrierung
  models/                  H1c-Netzwerkmodell
  modules/                 Fachmodule der Extension
  parser/                  Cisco-IOS-Parser
  shared/                  Gemeinsam verwendete Typen und Logik
  validation/              Anbindung der Konfigurationsprüfung
  webview/                 Oberfläche und Gestaltung der Interaktionen
  test/
    analysis/              Tests der Topologieanalyse
    configuration/         H2c-Modellanbindung, Validierung und Speicherung
    models/                Tests der H1c-Klassen
    parser/                Parsertests und zugehörige Fixtures
    topology/              Topologieverwaltung, Layout und Ansichtsregeln
    validation/            Tests der Editor-Konfigurationsprüfung
    extension.test.ts      Allgemeiner Extensiontest

test-workspace/             Manuelle Konfigurationsbeispiele und H2c-Beispieltopologie
media/                      Webview-Styles und zugehörige Medien
images/                     Projektbilder
scripts/                    Entwicklungs- und Inspektionswerkzeuge
```

Dokumentation wird unter `docs/` abgelegt. Tests spiegeln unter `src/test/`
die fachlichen Bereiche wider. Parser-Fixtures bleiben direkt bei ihren Tests;
Beispiele für manuelle F5-Tests liegen unter `test-workspace/`.

Die Anwendungsmodule, ihre Einstiegspunkte und die Build-Konfiguration wurden
beim Aufräumen nicht verschoben. Die Testsuche verwendet weiterhin
`out/test/**/*.test.js`.

## Prüfung nach Strukturänderungen

```powershell
npm.cmd run check-types
npm.cmd run lint
npm.cmd test
npm.cmd run inspect:device-model
```

Beim Verschieben weiterer Tests müssen deren relative Imports und Dateipfade
angepasst werden. Alte, generierte Testdateien am bisherigen Ort unter `out/test/`
dürfen nicht als doppelte Tests zurückbleiben.
