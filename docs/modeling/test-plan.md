# Testplan für H1.c

## Ziel

Die Tests weisen nach, dass das Modell gültige Topologien abbildet, ungültige
Zustände verhindert und von einem nachgelagerten Analysemodul verwendet wird.

## Teststrategie

- **Unit-Tests:** Einzelne Modellklassen und ihre Regeln isoliert prüfen.
- **Integrationstest:** Eine vollständige Topologie aufbauen und durch den
  `TopologyAnalyzer` auswerten lassen.
- **Regressionstest:** Bestehende Extension-Tests und `.cfg`-Validierung müssen
  weiterhin funktionieren.

## NetworkInterface

| ID | Testfall | Erwartung |
|---|---|---|
| IF-01 | Interface mit ID, Name und Typ erstellen | Objekt wird erstellt |
| IF-02 | Leere ID verwenden | Fehler wird ausgelöst |
| IF-03 | Leeren Namen verwenden | Fehler wird ausgelöst |
| IF-04 | IP und Maske gemeinsam setzen | Werte werden gespeichert |
| IF-05 | Nur IP ohne Maske setzen | Fehler wird ausgelöst |
| IF-06 | IP-Konfiguration entfernen | Beide Werte sind `undefined` |
| IF-07 | Interface aktivieren/deaktivieren | Status ändert sich korrekt |

## NetworkDevice

| ID | Testfall | Erwartung |
|---|---|---|
| DEV-01 | Gültigen Router erstellen | Objekt wird erstellt |
| DEV-02 | Leere ID oder leeren Hostnamen verwenden | Fehler wird ausgelöst |
| DEV-03 | Interface hinzufügen und finden | Interface wird zurückgegeben |
| DEV-04 | Doppelte Interface-ID hinzufügen | Fehler wird ausgelöst |
| DEV-05 | Doppelten Interface-Namen hinzufügen | Fehler wird ausgelöst |
| DEV-06 | Interface entfernen | Interface ist nicht mehr vorhanden |
| DEV-07 | Unterstütztes Protokoll hinzufügen | Protokoll wird gespeichert |
| DEV-08 | Gleichen Protokolltyp zweimal hinzufügen | Fehler wird ausgelöst |
| DEV-09 | OSPF zu PC hinzufügen | Fehler wird ausgelöst |

## NetworkTopology und Verbindungen

| ID | Testfall | Erwartung |
|---|---|---|
| TOP-01 | Gerät hinzufügen und finden | Gerät wird zurückgegeben |
| TOP-02 | Doppelte Geräte-ID hinzufügen | Fehler wird ausgelöst |
| TOP-03 | Zwei vorhandene Interfaces verbinden | Verbindung wird gespeichert |
| TOP-04 | Verbindung mit unbekanntem Gerät | Fehler wird ausgelöst |
| TOP-05 | Verbindung mit unbekanntem Interface | Fehler wird ausgelöst |
| TOP-06 | Interface mit sich selbst verbinden | Fehler wird ausgelöst |
| TOP-07 | Bereits belegtes Interface erneut verbinden | Fehler wird ausgelöst |
| TOP-08 | Identische Verbindung umgekehrt hinzufügen | Fehler wird ausgelöst |
| TOP-09 | Gerät entfernen | Gerät wird entfernt |
| TOP-10 | Verbundenes Gerät entfernen | Zugehörige Verbindungen verschwinden |

## TopologyAnalyzer

| ID | Testfall | Erwartung |
|---|---|---|
| ANA-01 | Gerät besitzt kein Interface | Issue `DEVICE_WITHOUT_INTERFACE` |
| ANA-02 | Aktiviertes Interface ohne IP-Konfiguration | entsprechendes Issue |
| ANA-03 | Zwei Interfaces verwenden dieselbe IP-Adresse | Issue `DUPLICATE_IP_ADDRESS` |
| ANA-04 | Gerät besitzt keine Verbindung | Issue `DEVICE_WITHOUT_CONNECTION` |
| ANA-05 | Vollständig gültige Topologie | keine Issues |

## Integrationsszenario

Folgende Topologie wird im Test aufgebaut:

```text
Router1 / GigabitEthernet0/0
192.168.1.1 255.255.255.0
              |
              |
Router2 / GigabitEthernet0/0
192.168.1.2 255.255.255.0
```

Testschritte:

1. Zwei Router erzeugen.
2. Je ein GigabitEthernet-Interface erzeugen.
3. Interfaces den Routern hinzufügen.
4. Router einer Topologie hinzufügen.
5. Verbindung zwischen beiden Interfaces hinzufügen.
6. OSPF als Protokoll hinzufügen.
7. Topologie an den Analyzer übergeben.
8. Prüfen, dass keine Issues zurückgegeben werden.

Dieser Test ist zugleich der Nachweis, dass ein nachgelagertes Modul das Modell
erfolgreich konsumiert.

## Beispiel für einen Mocha-Test

```ts
import * as assert from "assert";
import {
  DeviceType,
  NetworkDevice,
  NetworkTopology
} from "../../models";

suite("NetworkTopology", () => {
  test("rejects duplicate device IDs", () => {
    const topology = new NetworkTopology({ id: "top-1", name: "Lab" });

    topology.addDevice(
      new NetworkDevice({
        id: "r1",
        hostname: "Router1",
        type: DeviceType.Router
      })
    );

    assert.throws(() => {
      topology.addDevice(
        new NetworkDevice({
          id: "r1",
          hostname: "Router2",
          type: DeviceType.Router
        })
      );
    }, /already exists/);
  });
});
```

## Ausführung

```bash
npm run check-types
npm run lint
npm test
```

Erwartetes Ergebnis:

- keine TypeScript-Fehler,
- keine ESLint-Fehler,
- alle Modell- und Analysetests erfolgreich,
- bestehende Extension-Tests weiterhin erfolgreich.

## Abnahmetabelle

| Prüfung | Ergebnis | Nachweis/Link |
|---|---|---|
| TypeScript-Prüfung erfolgreich | Offen | CI-Ausgabe oder Screenshot |
| ESLint erfolgreich | Offen | CI-Ausgabe oder Screenshot |
| Alle Unit-Tests erfolgreich | Offen | CI-Ausgabe oder Screenshot |
| Integrationsszenario erfolgreich | Offen | Testname/CI-Ausgabe |
| UML mit Code abgeglichen | Offen | Review-Kommentar |
| Nachgelagertes Modul verwendet Modell | Offen | `topologyAnalyzer.test.ts` |
| Pull Request reviewed | Offen | PR-Link |

