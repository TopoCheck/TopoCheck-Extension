# H2c: Geräte konfigurieren

## Bedienung

1. `npm.cmd run compile` ausführen und die Extension mit F5 starten.
2. `TopoCheck: Create Topology` oder `TopoCheck: Open Topology View` aufrufen.
3. Ein vorhandenes Gerät einfach anklicken. Alternativ Enter auf dem ausgewählten
   Gerät oder den Kontextmenüeintrag `Configure Device…` verwenden.
4. Hostname bearbeiten. Der Gerätetyp wird nur angezeigt.
5. Vorhandene Interfaces auswählen und bei Bedarf IPv4-Adresse und Subnetzmaske
   gemeinsam eintragen. Der Aktivierungsschalter ist unabhängig von der physischen
   Portbelegung; das Deaktivieren entfernt keine Kabel.
6. Unterstützte Protokolle auswählen und ihren Aktivierungszustand festlegen.
   Abgewählte Protokolle werden beim Speichern entfernt. PCs bieten keine Protokolle.
7. Speichern übernimmt alle Angaben gemeinsam. Abbrechen oder Escape verwirft den
   Entwurf. Während des Speicherns bleibt das Formular bis zur Bestätigung gesperrt.

Der Kabelmodus verwendet weiterhin die bestehende Portauswahl. Ziehen verschiebt
das Gerät, ohne das Formular zu öffnen. Ein modaler Dialog verhindert, dass ein
Gerätewechsel einen offenen Entwurf überschreibt.

## Daten und Validierung

- `shared/deviceConfiguration.ts` enthält die gemeinsame Validierung und erstellt
  echte H1c-Objekte (`NetworkDevice`, `NetworkInterface`, `NetworkProtocol`).
- Die Extension validiert Nachrichten und Konfiguration unabhängig vom Browser.
- `TopologyStore.configureDevice` speichert Hostname, Interface-Konfiguration und
  Protokolle in einem Schreibvorgang und löst `DeviceConfigUpdated` aus.
- Geräte-, Interface- und bestehende Protokoll-IDs bleiben erhalten. Kabel und
  Layout werden nicht geändert.
- Neue Speicherfelder sind optional und ergänzen Schema 2. Bestehende Topologien
  ohne diese Felder bleiben lesbar: keine IP-Konfiguration, keine Protokolle,
  Interfaces standardmäßig aktiviert. Die bisherigen Schema-1-Migrationen bleiben
  gültig.
- IP-Adresse und Maske sind gemeinsam optional. IPv4-Oktette und zusammenhängende
  Maskenbits werden geprüft. Hostnamen müssen gültig und eindeutig sein.
- Die Protokollauswahl verwendet dieselbe Kompatibilitätstabelle wie H1c. Es werden
  Auswahl und Aktivierung gespeichert, keine protokollspezifischen Cisco-Befehle
  generiert.

## Verifikation

`npm.cmd test` prüft zusätzlich zu den bestehenden Tests die Modellabbildung,
Legacy-Standardwerte, ungültige Eingaben/Nachrichten, Hostnamen und Protokolle sowie
Speichern, erneutes Laden, stabile IDs, Kabelerhalt und die atomare Ablehnung eines
ungültigen Entwurfs. Typprüfung, Lint und alle 146 Tests waren erfolgreich.

Am 29.10.2026 wurde das gebaute Webview-Bundle außerdem in einer lokalen
Browser-Testseite mit simulierter VS-Code-Nachrichtenanbindung geprüft:

| Fall | Ergebnis |
| --- | --- |
| Einfacher Geräteklick | Dialog mit vorhandenen Interfaces geöffnet |
| `999.1.1.1` speichern | Verständliche Fehlermeldung; Dialog bleibt offen |
| Interface wechseln und zurück | Entwurfswerte erhalten |
| Hostname, gültige IP/Maskenwerte und OSPF speichern | Bestätigung schließt Dialog; Ansicht aktualisiert |
| Konfiguration erneut öffnen | Gespeicherte Eingaben und OSPF vorausgefüllt |
| Hostname ändern und abbrechen | Bisheriger Hostname unverändert |

Der Browser-Test verwendet einen simulierten Transport. Die echte Dateispeicherung
ist durch die VS-Code-Integrationstests geprüft. Ein vollständiger manueller
Durchlauf im F5-Fenster und das Team-Review stehen für die finale H2c-Abnahme noch aus.
