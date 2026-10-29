# H2c: Geräte konfigurieren

## Bedienung

1. `npm.cmd run compile` ausführen und die Extension mit F5 starten.
2. `TopoCheck: Create Topology` oder `TopoCheck: Open Topology View` aufrufen.
3. Ein vorhandenes Gerät einfach anklicken. Alternativ Enter auf dem ausgewählten
   Gerät oder den Kontextmenüeintrag `Configure Device…` verwenden.
4. Im rechten Eigenschaftenpanel Name/Label und Hostname getrennt bearbeiten.
   Domain-Name, Benutzername, Enable Secret, Console-/VTY-Passwort und Banner sind
   optional. Der Gerätetyp wird im Kopfbereich angezeigt.
5. Standardmäßig werden nur aktuell verbundene und aktivierte Interfaces als Karten angezeigt.
   Mit „Alle Interfaces anzeigen“ lassen sich auch freie oder deaktivierte Ports einblenden.
   Ein kurzer Hinweis erklärt den aktuellen Filter. Bei Bedarf
   IPv4-Adresse und Subnetzmaske gemeinsam eintragen und eine Beschreibung ergänzen.
   Eine Layer-Auswahl wird nicht angezeigt. Der Aktivierungsschalter ist unabhängig von der physischen Portbelegung;
   das Deaktivieren entfernt keine Kabel.
6. Unterstützte Protokolle auswählen und ihren Aktivierungszustand festlegen.
   Abgewählte Protokolle werden beim Speichern entfernt. PCs bieten keine Protokolle.
7. Speichern übernimmt alle Angaben gemeinsam. Abbrechen verwirft den Entwurf.
   Schließen/Escape und Gerätewechsel fragen bei ungespeicherten Änderungen nach.
   Während des Speicherns bleibt das Formular bis zur Bestätigung gesperrt.

Der Kabelmodus verwendet weiterhin die bestehende Portauswahl. Ziehen verschiebt
das Gerät, ohne das Formular zu öffnen. Das Panel lässt die Zeichenfläche bedienbar.
Bei einem Gerätewechsel kann man ungespeicherte Änderungen verwerfen oder weiter
bearbeiten. Auf schmalen Ansichten liegt das Panel am rechten Rand über der Fläche.

## Daten und Validierung

- `shared/deviceConfiguration.ts` enthält die gemeinsame Validierung und erstellt
  echte H1c-Objekte (`NetworkDevice`, `NetworkInterface`, `NetworkProtocol`).
- Die Extension validiert Nachrichten und Konfiguration unabhängig vom Browser.
- `TopologyStore.configureDevice` speichert Label, Hostname, Zugangsangaben,
  Interface-Konfiguration und Protokolle gemeinsam und löst `DeviceConfigUpdated` aus.
  Das Label ist die sichtbare Bezeichnung; eine Hostname-Änderung im Formular
  überschreibt dieses Label nicht mehr.
- `TopologyStore.loadNetworkDevice(topologyId, deviceId)` lädt gespeicherte Daten
  direkt als H1c-Gerät. `toNetworkDevice` ist die zentrale Abbildung für gespeicherte
  Geräte; sie benötigt weder VS Code noch ein Formular. Explizit gespeicherte
  Interfacetypen werden erhalten; alte Dateien verwenden die Ableitung aus dem Namen.
- Geräte-, Interface- und bestehende Protokoll-IDs bleiben erhalten. Kabel und
  Layout werden nicht geändert.
- Neue Speicherfelder sind optional und ergänzen Schema 2. Bestehende Topologien
  ohne diese Felder bleiben lesbar: keine IP-Konfiguration, keine Protokolle,
  Interfaces ohne Aktivierungsangabe nur bei vorhandener Verbindung aktiviert. Die bisherigen Schema-1-Migrationen bleiben
  gültig.
- Die neuen optionalen Geräteangaben kommen im H1c-`NetworkDevice` an;
  Interface-Beschreibung und Layer in `NetworkInterface`. Ein fehlender Layer wird
  beim Switch mit 2, bei Router/PC mit 3 vorbelegt. Der Layer ist hier eine
  Konfigurationsangabe; es werden daraus keine Cisco-Befehle generiert.
  Bereits vorhandene Layer-Werte bleiben beim Speichern erhalten; sie sind im Panel
  nicht mehr bearbeitbar. Der Interfacefilter verändert keine Konfigurationswerte.
  Geänderte Verbindungen aktualisieren die Anzeige auch bei geöffnetem Panel.
  Neue/freie Ports sind standardmäßig deaktiviert. Eine neue Kabelverbindung
  aktiviert ihre beiden Endpunkte automatisch; Trennen oder Löschen des Gegenübers
  deaktiviert sie wieder. Eine ausdrücklich gespeicherte manuelle Deaktivierung
  bleibt beim Laden erhalten. Beim Filter bedeutet „in Nutzung“: verbunden und aktiviert.
  Bei einem Validierungsfehler an einem ausgeblendeten Port wird „Alle Interfaces
  anzeigen“ automatisch aktiviert und das fehlerhafte Feld fokussiert.
- Passwortfelder sind maskiert. Der Modell-Inspektionsbefehl zeigt nur an, ob ein
  Passwort gesetzt ist; ungültige Nachrichten werden ohne ihren Inhalt protokolliert.
- IP-Adresse und Maske sind gemeinsam optional. IPv4-Oktette und zusammenhängende
  Maskenbits werden geprüft. Hostnamen müssen gültig und eindeutig sein.
- Die Protokollauswahl verwendet dieselbe Kompatibilitätstabelle wie H1c. Es werden
  Auswahl und Aktivierung gespeichert, keine protokollspezifischen Cisco-Befehle
  generiert.

## Verifikation

Die gemeinsame Speicheroperation und Tests für fehlgeschlagene Schreibvorgänge
sind in [Gerätekonfiguration speichern](device-configuration-save.md) beschrieben.

`npm.cmd test` prüft zusätzlich zu den bestehenden Tests die Modellabbildung,
Legacy-Standardwerte, ungültige Eingaben/Nachrichten, Hostnamen und Protokolle sowie
Speichern, erneutes Laden, stabile IDs, Kabelerhalt und die atomare Ablehnung eines
ungültigen Entwurfs. Für die Datenanbindung kommen Tests für echte H1c-Klassen beim
Laden, vorhandene IDs/Interfacetypen und eine Beispieldatei samt Schema-1-Fallback hinzu.
Stand nach der gemeinsamen Feldvalidierung: Typprüfung und Lint erfolgreich;
169 Tests insgesamt, davon 29 H2c-Tests. Zusätzliche Tests prüfen die Speicherung,
das Leeren und das Laden sämtlicher neuer Felder sowie ihre Validierung.

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

### Gemeinsame Validierung und Feldfehler

`validateDeviceConfiguration(device, configuration, otherHostnames)` in
`src/shared/validateDeviceConfiguration.ts` ist eine reine Funktion ohne VS-Code-
oder DOM-Abhängigkeiten. Sie verändert keine Werte und liefert eine Liste aller
gefundenen Fehler. Eine leere Liste bedeutet: gültig.

Jeder Fehler enthält `field`, `code` und eine verständliche deutsche `message`:

```json
{
  "field": "interfaces.0.subnetMask",
  "code": "subnet-mask-required",
  "message": "GigabitEthernet0/0: Bitte zur IP-Adresse eine Subnetzmaske angeben."
}
```

Die Interface- und Protokollindizes beziehen sich auf die übergebene Konfiguration.
Geprüft werden Hostname und Eindeutigkeit, IPv4, vollständige IP/Maskenpaare,
zusammenhängende Maskenbits, Protokollkompatibilität sowie vorhandene Geräte und
zugehörige Interfaces. Fehlende Geräte werden als `deviceId` gemeldet. Doppelte,
fremde oder unvollständige Interfaceauswahlen werden abgelehnt.

Hostname und Protokollkompatibilität verwenden die vorhandenen Regeln. Die
IPv4-/Maskenregeln stehen gemeinsam in `src/models/ipv4.ts` und werden auch von
`NetworkInterface.setIpConfiguration` verwendet. Damit lehnt das H1c-Modell jetzt
selbst nicht zusammenhängende Masken ab. `/0` und `/32` bleiben gültige Masken.

Das Formular markiert betroffene Felder und zeigt die Meldung direkt daneben an.
Bei einem Fehler auf einer Interface-Karte wird das fehlerhafte Feld fokussiert
und in den sichtbaren Bereich gescrollt. Die Extension prüft erneut gegen den aktuellen
Speicherstand; `DeviceConfigurationValidationError` transportiert die Feldfehler
auch zurück zum Formular. Eine ungültige Konfiguration wird nicht gespeichert.

Manuelle Beispiele im F5-Fenster:

| Eingabe beim Speichern | Erwartung |
| --- | --- |
| Hostname leer | Fehler direkt am Hostname-Feld |
| Hostname eines anderen Geräts (auch andere Groß-/Kleinschreibung) | Hostname bereits vergeben |
| IP `999.1.1.1`, Maske `255.0.255.0` | Beide Felder werden gleichzeitig markiert |
| IP `10.0.0.1`, Maske leer | Fehlermeldung am Maskenfeld |
| IP leer, Maske `255.255.255.0` | Fehlermeldung am IP-Feld |
| IP und Maske leer | Zulässig |
| IP `10.0.0.1`, Maske `255.255.255.0` | Zulässig |
| Fehler auf einer nach unten gescrollten Interface-Karte | Fehlerhaftes Feld wird beim Speichern fokussiert und sichtbar |

Diese Browserfälle wurden am 29.10.2026 mit dem gebauten Bundle in der lokalen
Testseite geprüft: drei gleichzeitige Fehler an Hostname/IP/Maske und automatische
Navigation zum Maskenfehler des zweiten Interfaces. Die echte Extension-Speicherung
und die strukturierten Store-Fehler sind automatisiert geprüft.

Nur die 13 Tests der reinen Feldvalidierung ausführen:

```powershell
npm.cmd test -- --grep "H2c field validation"
```

Auch `inspect:device-model` zeigt Fehler mit Feldpfaden an. Beispielsweise erzeugt
eine Kopie der JSON-Beispieldatei mit leerem Router-Hostnamen und ungültiger IP/Maske
gleichzeitig Meldungen für `[hostname]`, `[interfaces.0.ipAddress]` und
`[interfaces.0.subnetMask]`.

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
