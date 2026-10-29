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
- `TopologyStore.loadNetworkDevice(topologyId, deviceId)` lädt gespeicherte Daten
  direkt als H1c-Gerät. `toNetworkDevice` ist die zentrale Abbildung für gespeicherte
  Geräte; sie benötigt weder VS Code noch ein Formular. Explizit gespeicherte
  Interfacetypen werden erhalten; alte Dateien verwenden die Ableitung aus dem Namen.
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
ungültigen Entwurfs. Für die Datenanbindung kommen Tests für echte H1c-Klassen beim
Laden, vorhandene IDs/Interfacetypen und eine Beispieldatei samt Schema-1-Fallback hinzu.
Stand der Prüfung: Typprüfung und Lint erfolgreich; 149 Tests insgesamt sowie
9 gezielt mit `--grep H2c` ausgeführte Tests erfolgreich.

### Datenanbindung selbst testen (ohne Formular)

Im Projektterminal ausführen:

```powershell
npm.cmd run inspect:device-model
```

Der Befehl kompiliert TypeScript und liest `test-workspace/h2c-topology.json`.
Er zeigt das geladene H1c-Modell an und verändert die Datei nicht.

| Prüfung | Erwartete Ausgabe |
| --- | --- |
| Router | `modelClass: NetworkDevice`, Hostname `RouterExample` |
| Erstes Router-Interface | `NetworkInterface`, ID `router-example-uplink`, IP `10.0.0.1`, Maske `255.255.255.0` |
| Zweites Router-Interface | `enabled: false`, keine IP/Maskenwerte |
| Router-Protokoll | `NetworkProtocol`, ID `router-example-ospf`, Typ `ospf`, aktiviert |
| Alter PC ohne Konfigurationsfelder | Interface aktiviert, keine IP/Maskenwerte, leere Protokollliste |

Ein einzelnes Gerät auswählen:

```powershell
npm.cmd run inspect:device-model -- test-workspace/h2c-topology.json pc-legacy
```

Für eigene Änderungen eine Kopie der Beispieldatei anlegen, diese in VS Code
bearbeiten und ihren Pfad übergeben:

```powershell
npm.cmd run inspect:device-model -- "C:\Pfad\zur\Kopie.json"
```

- Router-Hostname und IP ändern: Die neuen Werte müssen in der Ausgabe erscheinen,
  Geräte-/Interface-/Protokoll-IDs bleiben gleich.
- IP `999.1.1.1` oder Maske `255.0.255.0` setzen: Der Befehl muss mit einer
  verständlichen Fehlermeldung und Exitcode 1 abbrechen.
- Nur die IP eintragen und die Maske entfernen: Die unvollständige Konfiguration
  muss abgelehnt werden.
- Beim Router `vlan` als Protokoll setzen: Unpassendes Protokoll wird abgelehnt.
- Beim alten PC die optionalen Felder weglassen: Standardwerte werden verwendet.

Die echte Speicher-/Ladekette ohne Formular prüfen:

```powershell
npm.cmd test -- --grep "H2c"
```

Die H2c-Tests schreiben in temporäre Testordner, erstellen eine neue Store-Instanz,
laden echte H1c-Objekte und vergleichen Werte, IDs und Kabel. Sie prüfen außerdem,
dass ungültige Änderungen den gespeicherten Stand nicht verändern. Die Tests räumen
ihre Testordner anschließend auf.

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
