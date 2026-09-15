# Implementierungsplan für H1.c

## Ziel

Dieser Plan beschreibt die empfohlene Reihenfolge. Nach jedem Schritt müssen
Typprüfung und zugehörige Unit-Tests erfolgreich sein.

## Schritt 1: Feature-Branch vorbereiten

Vom aktuellen `main` aus:

```bash
git switch main
git pull origin main
git switch -c feature/h1c-network-model
```

Falls bereits ein passender Feature-Branch existiert, wird dieser weiterverwendet.

## Schritt 2: Enums implementieren

Dateien:

- `src/models/deviceType.ts`
- `src/models/interfaceType.ts`
- `src/models/protocolType.ts`

Beispiel:

```ts
export enum DeviceType {
  Router = "router",
  Switch = "switch",
  Pc = "pc"
}
```

Dieser Schritt schafft eine feste Menge erlaubter Werte und verhindert frei
geschriebene, inkonsistente Strings.

## Schritt 3: Kleine Wertobjekte implementieren

### NetworkInterface

Empfohlene öffentliche Schnittstelle:

```ts
export interface NetworkInterfaceData {
  id: string;
  name: string;
  type: InterfaceType;
  enabled?: boolean;
  ipAddress?: string;
  subnetMask?: string;
}

export class NetworkInterface {
  constructor(data: NetworkInterfaceData);
  setIpConfiguration(ipAddress: string, subnetMask: string): void;
  clearIpConfiguration(): void;
  enable(): void;
  disable(): void;
}
```

Der Konstruktor validiert Pflichtfelder und Regel R-05. IPv4-Syntaxprüfung kann
in einer kleinen privaten Hilfsfunktion erfolgen. Eine vollständige semantische
Netzprüfung ist Aufgabe des späteren Analysemoduls.

### NetworkProtocol

```ts
export interface NetworkProtocolData {
  id: string;
  type: ProtocolType;
  enabled?: boolean;
}

export class NetworkProtocol {
  constructor(data: NetworkProtocolData);
  enable(): void;
  disable(): void;
}
```

## Schritt 4: NetworkDevice implementieren

```ts
export interface NetworkDeviceData {
  id: string;
  hostname: string;
  type: DeviceType;
}

export class NetworkDevice {
  constructor(data: NetworkDeviceData);

  get interfaces(): readonly NetworkInterface[];
  get protocols(): readonly NetworkProtocol[];

  addInterface(networkInterface: NetworkInterface): void;
  removeInterface(interfaceId: string): boolean;
  findInterface(interfaceId: string): NetworkInterface | undefined;

  addProtocol(protocol: NetworkProtocol): void;
  removeProtocol(protocolId: string): boolean;
  findProtocol(protocolId: string): NetworkProtocol | undefined;
}
```

Die internen Arrays bleiben privat. `readonly` verhindert, dass andere Module
Regeln umgehen, indem sie direkt Elemente in die Arrays schreiben.

Hier werden R-03, R-04, R-11 und R-12 umgesetzt.

## Schritt 5: Verbindungstypen implementieren

```ts
export interface ConnectionEndpoint {
  deviceId: string;
  interfaceId: string;
}

export interface NetworkConnectionData {
  id: string;
  source: ConnectionEndpoint;
  target: ConnectionEndpoint;
}

export class NetworkConnection {
  constructor(data: NetworkConnectionData);
  usesDevice(deviceId: string): boolean;
  usesInterface(deviceId: string, interfaceId: string): boolean;
}
```

Die Verbindung kennt IDs. Ob diese IDs existieren, prüft die Topologie, weil
nur sie alle Geräte kennt.

## Schritt 6: NetworkTopology implementieren

```ts
export interface NetworkTopologyData {
  id: string;
  name: string;
}

export class NetworkTopology {
  constructor(data: NetworkTopologyData);

  get devices(): readonly NetworkDevice[];
  get connections(): readonly NetworkConnection[];

  addDevice(device: NetworkDevice): void;
  removeDevice(deviceId: string): boolean;
  findDevice(deviceId: string): NetworkDevice | undefined;

  addConnection(connection: NetworkConnection): void;
  removeConnection(connectionId: string): boolean;
  findConnection(connectionId: string): NetworkConnection | undefined;
}
```

`addConnection` führt die Prüfungen R-06 bis R-09 in dieser Reihenfolge aus:

1. Verbindungs-ID ist eindeutig.
2. Source und Target sind nicht identisch.
3. Beide Geräte existieren.
4. Beide Interfaces existieren auf den angegebenen Geräten.
5. Keines der Interfaces wird bereits verwendet.
6. Die Verbindung existiert auch in umgekehrter Richtung noch nicht.

`removeDevice` entfernt zuerst alle Verbindungen des Geräts und danach das
Gerät. Damit gilt R-10 automatisch.

## Schritt 7: Zentralen Export anlegen

`src/models/index.ts`:

```ts
export * from "./deviceType";
export * from "./interfaceType";
export * from "./protocolType";
export * from "./networkInterface";
export * from "./networkProtocol";
export * from "./networkDevice";
export * from "./connectionEndpoint";
export * from "./networkConnection";
export * from "./networkTopology";
```

## Schritt 8: Analyzer als Konsument implementieren

```ts
import { NetworkTopology } from "../models";

export interface TopologyIssue {
  code: string;
  message: string;
  deviceId?: string;
  interfaceId?: string;
}

export function analyzeTopology(
  topology: NetworkTopology
): TopologyIssue[] {
  // Geräte und Interfaces analysieren und Probleme sammeln.
  return [];
}
```

Der Integrationstest baut eine Topologie ausschließlich über das Modell auf und
übergibt sie an `analyzeTopology`. Damit wird das Konsum-Kriterium nachgewiesen.

## Schritt 9: Tests parallel zum Code schreiben

Nicht erst am Ende testen. Empfohlene Reihenfolge:

1. `NetworkInterface` implementieren und testen.
2. `NetworkDevice` implementieren und testen.
3. `NetworkConnection` und `NetworkTopology` implementieren und testen.
4. Analyzer implementieren und Integrationstest schreiben.

Die konkreten Testfälle stehen in `test-plan.md`.

## Schritt 10: Dokumentation synchronisieren

Nach der Implementierung:

- UML-Namen, Attribute und Methoden mit dem Code vergleichen.
- Architekturabschnitt im Projekt-`README.md` ergänzen.
- Änderung in `CHANGELOG.md` eintragen.
- Offene Entscheidungen in `docs/modeling/README.md` auflösen.

## Lokale Qualitätsprüfung

```bash
npm run check-types
npm run lint
npm test
```

Danach die Extension mit `F5` starten und kontrollieren, dass die vorhandene
Validierung von `.cfg`-Dateien weiterhin funktioniert.

## Empfohlene Commits

```text
docs(models): plan network domain model and add UML
feat(models): add device interface and protocol models
feat(models): add topology and connection rules
feat(analysis): analyze network topology model
test(models): cover domain rules and analyzer integration
docs(models): synchronize model documentation
```

## Pull-Request-Beschreibung

```text
## Ziel
Implementiert das interne Datenmodell für H1.c.

## Enthalten
- Geräte, Interfaces, Protokolle und Verbindungen
- Topologieverwaltung und Konsistenzregeln
- Analyzer als nachgelagertes Modul
- Unit- und Integrationstests
- UML-Diagramm

## Testnachweis
- npm run check-types
- npm run lint
- npm test

## DoD
- [ ] UML und Code abgeglichen
- [ ] Tests erfolgreich
- [ ] Review abgeschlossen
```

