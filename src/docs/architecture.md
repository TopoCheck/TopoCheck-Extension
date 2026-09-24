# TopoCheck – Backend-Architektur

## 1. Überblick

TopoCheck verwendet eine modulare Backend-Architektur. Die einzelnen fachlichen Bereiche werden als eigenständige Module umgesetzt.

Der Einstiegspunkt der VS-Code-Extension ist `extension.ts`. Beim Aktivieren der Extension wird die `ModuleRegistry` erstellt. Über diese werden die einzelnen Backend-Module registriert und initialisiert.

Die Module kommunizieren über definierte Interfaces und sind dadurch möglichst lose voneinander gekoppelt.

## 2. Architektur

```text
                    ┌─────────────────────┐
                    │     extension.ts    │
                    │ VS Code Entry Point │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   ModuleRegistry    │
                    │                     │
                    │ register()          │
                    │ get()               │
                    │ initializeAll()     │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
 ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
 │ TopologyModule │   │  ConfigModule  │   │ Diagnostics-   │
 │                │   │                │   │    Module      │
 └────────────────┘   └────────────────┘   └────────────────┘
          |                    │                    |
          |                    ▼                    |
          |           ┌─────────────────┐           |
          |           │ Config Validator│           |
          |           └─────────────────┘           |
          |_________________________________________|
                               |
                    ┌─────────────────────┐
                    │ ExternalApiModule   │
                    └─────────────────────┘
                               |
                    ┌─────────────────────┐
                    │    ExampleModule    │
                    │  Erweiterbarkeits-  │
                    │     beispiel        │
                    └─────────────────────┘
```

Das Diagramm zeigt die Verantwortlichkeiten und Abhängigkeiten der Komponenten. Es stellt nicht den vollständigen Programmablauf dar.

## 3. Komponenten

### 3.1 extension.ts

`extension.ts` ist der Einstiegspunkt der VS-Code-Extension.

Die Datei übernimmt unter anderem die Aktivierung der Extension und die Initialisierung der Backend-Architektur. Die eigentliche Funktionalität wird in die jeweiligen Module ausgelagert.

### 3.2 ModuleRegistry

Die `ModuleRegistry` verwaltet alle registrierten Backend-Module.

Sie stellt folgende Funktionen bereit:

* `register()` – registriert ein Modul
* `get()` – ruft ein Modul anhand seines Namens ab
* `initializeAll()` – initialisiert alle registrierten Module

Die Registry arbeitet ausschließlich mit dem `IModule`-Interface und muss daher die konkrete Implementierung der einzelnen Module nicht kennen.

### 3.3 IModule

`IModule` definiert den gemeinsamen Aufbau aller Backend-Module:

```ts
export interface IModule {
    name: string;
    initialize(): void;
}
```

Dadurch besitzen alle Module eine einheitliche Schnittstelle und können von der `ModuleRegistry` verwaltet werden.

### 3.4 IService

`IService` ist für zukünftige Services innerhalb der Module vorgesehen.

Aktuell definiert das Interface lediglich einen Namen:

```ts
export interface IService {
    name: string;
}
```

Die konkrete Implementierung von Services erfolgt bei der späteren Erweiterung der einzelnen Module.

## 4. Backend-Module

### TopologyModule

Zuständig für zukünftige Funktionen zur Verwaltung der Netzwerktopologie, beispielsweise Geräte und Verbindungen.

### ConfigModule

Zuständig für zukünftige Konfigurationsverwaltung und die Generierung von Konfigurationsdateien.

### DiagnosticsModule

Zuständig für zukünftige Fehleranalyse und Diagnosen, beispielsweise die Überprüfung auf doppelte IP-Adressen.

### ExternalApiModule

Kapselt die Kommunikation mit externen Schnittstellen und APIs.

### ExampleModule

Das `ExampleModule` besitzt keine produktive Funktionalität. Es dient als Beispiel dafür, wie ein neues Modul in die Architektur integriert werden kann.

## 5. Erweiterbarkeit

Neue Module können implementiert werden, indem sie das `IModule`-Interface erfüllen und anschließend bei der `ModuleRegistry` registriert werden.

Beispiel:

```ts
export class ExampleModule implements IModule {
    name = "example";

    initialize(): void {
        console.log("Example module initialized");
    }
}
```

Anschließend kann das Modul registriert werden:

```ts
registry.register(new ExampleModule());
```

Bestehende Module müssen dafür nicht verändert werden. Dadurch unterstützt die Architektur die Erweiterbarkeit und eine lose Kopplung der Komponenten.

## 6. Ordnerstruktur

Die für die modulare Backend-Architektur relevanten Dateien befinden sich in folgenden Bereichen:

```text
src/
│   extension.ts
│   README.md
│
├───core
│   │   ModuleRegistry.ts
│   │
│   └───interfaces
│           IModule.ts
│           IService.ts
│
├───docs
│       architecture.md
│
├───example-module
│       ExampleModule.ts
│
├───modules
│   ├───config
│   │       ConfigModule.ts
│   │       index.ts
│   │
│   ├───diagnostics
│   │       DiagnosticsModule.ts
│   │       index.ts
│   │
│   ├───external-api
│   │       ExternalApiModule.ts
│   │       index.ts
│   │
│   └───topology
│           index.ts
│           TopologyModule.ts
│
├───test
│       extension.test.ts
│
├───test-workspace
│       invalid-router.cfg
│       valid-router.cfg
│
└───validation
        configValidator.ts

```

## 7. Integration in extension.ts

Beim Aktivieren der Extension werden die Module registriert und anschließend initialisiert:

```ts
const registry = new ModuleRegistry();

registry.register(new TopologyModule());
registry.register(new ConfigModule());
registry.register(new DiagnosticsModule());
registry.register(new ExternalApiModule());
registry.register(new ExampleModule());

registry.initializeAll();
```

Die bestehende Funktionalität der Extension, insbesondere die Konfigurationsvalidierung, bleibt dabei erhalten.

## 8. Ziel der Architektur

Die modulare Architektur schafft eine Grundlage für die zukünftige Erweiterung von TopoCheck.

Wichtige Eigenschaften sind:

* klare Trennung der Verantwortlichkeiten
* lose Kopplung der Module
* definierte Interfaces
* einfache Erweiterbarkeit
* bessere Wartbarkeit
* parallele Bearbeitung verschiedener Module durch das Team
