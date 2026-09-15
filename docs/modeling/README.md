# Planung: Interne Daten- und Modellierungslogik

## Bezug zum Subziel

Diese Planung deckt **Subziel H1.c** ab: Netzwerkgeräte, Interfaces,
Verbindungen und Protokolle werden als gemeinsames internes Datenmodell
abgebildet. Das Modell dient später als Grundlage für Parser, Analyse,
Soll-Ist-Vergleich und Konfigurationsgeneratoren.

## Abgrenzung

### Bestandteil dieses Subziels

- Fachliches Modell für Topologie, Geräte, Interfaces, Verbindungen und
  Protokolle
- Konsistenzregeln für das Hinzufügen und Entfernen dieser Objekte
- Serialisierbare Datenstrukturen ohne Abhängigkeit von der VS-Code-API
- Unit-Tests für Kernklassen und Geschäftsregeln
- Ein kleines Analysemodul als erster Konsument des Modells
- UML-Diagramm und technische Dokumentation

### Nicht Bestandteil dieses Subziels

- Vollständiger Cisco-IOS-Parser
- Grafische Topologieansicht
- Vollständige Konfigurationsgeneratoren für alle Protokolle
- Simulation von Netzwerkverkehr
- Persistenz in einer Datenbank

## Architekturentscheidung

Die Modelle liegen unter `src/models` und importieren **kein** `vscode`.
Dadurch können sie unabhängig von der Extension ausgeführt und getestet werden.

`NetworkTopology` ist das Aggregate Root. Änderungen an Geräten und
Verbindungen, die die gesamte Topologie betreffen, laufen über diese Klasse.
`NetworkDevice` verwaltet seine eigenen Interfaces und Protokolle.

```text
VS-Code-Extension / Webview
            |
            v
  Parser / Analyse / Generator
            |
            v
      src/models (H1.c)
```

## Geplante Ordnerstruktur

```text
src/
|-- models/
|   |-- deviceType.ts
|   |-- interfaceType.ts
|   |-- protocolType.ts
|   |-- networkInterface.ts
|   |-- networkProtocol.ts
|   |-- networkDevice.ts
|   |-- connectionEndpoint.ts
|   |-- networkConnection.ts
|   |-- networkTopology.ts
|   `-- index.ts
|-- analysis/
|   `-- topologyAnalyzer.ts
`-- test/
    |-- models/
    |   |-- networkDevice.test.ts
    |   `-- networkTopology.test.ts
    `-- analysis/
        `-- topologyAnalyzer.test.ts

docs/
|-- modeling/
|   |-- README.md
|   |-- implementation-plan.md
|   `-- test-plan.md
`-- uml/
    `-- network-data-model.md
```

## Fachliche Objekte

### NetworkTopology

Repräsentiert eine vollständige Netzwerktopologie.

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | `string` | Eindeutige ID der Topologie |
| `name` | `string` | Anzeigename |
| `devices` | `NetworkDevice[]` | Geräte der Topologie |
| `connections` | `NetworkConnection[]` | Kabel/Verbindungen |

### NetworkDevice

Repräsentiert Router, Switch oder PC.

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | `string` | Eindeutige Geräte-ID |
| `hostname` | `string` | Gerätename |
| `type` | `DeviceType` | Router, Switch oder PC |
| `interfaces` | `NetworkInterface[]` | Schnittstellen des Geräts |
| `protocols` | `NetworkProtocol[]` | Aktivierte Protokolle |

### NetworkInterface

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | `string` | Eindeutige ID innerhalb des Geräts |
| `name` | `string` | Cisco-Name, z. B. `GigabitEthernet0/0` |
| `type` | `InterfaceType` | Art des Interfaces |
| `enabled` | `boolean` | Administrativer Zustand |
| `ipAddress` | `string \| undefined` | Optionale IPv4-Adresse |
| `subnetMask` | `string \| undefined` | Optionale Subnetzmaske |

### NetworkConnection

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | `string` | Eindeutige Verbindungs-ID |
| `source` | `ConnectionEndpoint` | Erster Endpunkt |
| `target` | `ConnectionEndpoint` | Zweiter Endpunkt |

Ein `ConnectionEndpoint` enthält nur `deviceId` und `interfaceId`. So werden
Geräte nicht kopiert und Verbindungen bleiben serialisierbar.

### NetworkProtocol

Das gemeinsame Grundmodell enthält `id`, `type` und `enabled`. Spezifische
Einstellungen für OSPF, RIP, VLAN usw. werden später als eigene Typen ergänzt.

## Konsistenzregeln

| ID | Regel | Verantwortliche Klasse |
|---|---|---|
| R-01 | Topologie-ID und Name dürfen nicht leer sein. | `NetworkTopology` |
| R-02 | Geräte-IDs müssen in einer Topologie eindeutig sein. | `NetworkTopology` |
| R-03 | Hostname und Geräte-ID dürfen nicht leer sein. | `NetworkDevice` |
| R-04 | Interface-IDs und -Namen müssen pro Gerät eindeutig sein. | `NetworkDevice` |
| R-05 | IP-Adresse und Subnetzmaske werden gemeinsam oder gar nicht gesetzt. | `NetworkInterface` |
| R-06 | Beide Geräte und Interfaces einer Verbindung müssen existieren. | `NetworkTopology` |
| R-07 | Ein Interface darf nicht mit sich selbst verbunden werden. | `NetworkTopology` |
| R-08 | Ein Interface darf höchstens eine physische Verbindung besitzen. | `NetworkTopology` |
| R-09 | Verbindungen dürfen nicht doppelt existieren, auch nicht umgekehrt. | `NetworkTopology` |
| R-10 | Beim Löschen eines Geräts werden zugehörige Verbindungen entfernt. | `NetworkTopology` |
| R-11 | Ein Protokolltyp darf pro Gerät nur einmal vorhanden sein. | `NetworkDevice` |
| R-12 | Protokoll und Gerätetyp müssen kompatibel sein. | `NetworkDevice` |

## Protokoll-Kompatibilität der ersten Version

| Protokoll | Router | Switch | PC |
|---|:---:|:---:|:---:|
| RIP, OSPF, Static Route | Ja | Nein | Nein |
| VLAN, STP, RSTP, EtherChannel | Nein | Ja | Nein |
| ACL, NAT, PAT | Ja | Nein | Nein |
| DHCP | Ja | Ja | Nein |

Diese Matrix ist eine erste Projektentscheidung und muss vor der Implementierung
mit dem Team bzw. der Betreuung abgestimmt werden. Layer-3-Switches können in
einer späteren Version gesondert modelliert werden.

## Nachweis für das Acceptance Criterion „wird konsumiert“

`src/analysis/topologyAnalyzer.ts` verwendet ein `NetworkTopology`-Objekt und
liefert Analyseprobleme zurück. Die erste Version prüft:

- Geräte ohne Interfaces
- aktivierte Interfaces ohne vollständige IP-Konfiguration
- doppelt verwendete IPv4-Adressen
- Geräte ohne Verbindung

Damit existiert ein echter, automatisch testbarer Konsument des Datenmodells.

## Rückverfolgbarkeit zur Definition of Done

| Forderung | Nachweis |
|---|---|
| UML-Klassendiagramm vorhanden | `docs/uml/network-data-model.md` |
| Code implementiert | `src/models/` und `src/analysis/` |
| Unit-Tests vorhanden | `src/test/models/` und `src/test/analysis/` |
| Geräte vollständig abgebildet | `NetworkDevice`, `DeviceType` |
| Interfaces vollständig abgebildet | `NetworkInterface`, `InterfaceType` |
| Verbindungen vollständig abgebildet | `NetworkConnection`, `ConnectionEndpoint` |
| Protokolle vollständig abgebildet | `NetworkProtocol`, `ProtocolType` |
| Nachgelagertes Modul konsumiert Modell | `TopologyAnalyzer` und dessen Integrationstest |
| UML stimmt mit Code überein | Abschlussprüfung im Pull Request |

## Offene Entscheidungen vor Implementierungsbeginn

- Soll `hostname` innerhalb einer Topologie eindeutig sein oder nur die ID?
- Werden Layer-3-Switches bereits in Sprint 1 berücksichtigt?
- Darf ein Interface mehrere logische Verbindungen besitzen?
- Sollen IPv6-Adressen bereits Teil des Basismodells sein?
- Wird DHCP als Dienst, Protokoll oder eigene Konfiguration modelliert?

Die Antworten werden in diesem Dokument festgehalten, bevor die betroffene
Regel implementiert wird.

