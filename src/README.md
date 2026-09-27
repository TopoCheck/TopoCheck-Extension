## Architektur

TopoCheck verwendet eine modulare Backend-Architektur. Die einzelnen fachlichen Bereiche sind als eigenständige Module umgesetzt.

### Backend-Module

* **TopologyModule** – zukünftige Verwaltung der Netzwerktopologie
* **ConfigModule** – zukünftige Konfigurationsverwaltung und -generierung
* **DiagnosticsModule** – zukünftige Fehleranalyse
* **ExternalApiModule** – Kommunikation mit externen Schnittstellen
* **ExampleModule** – Demonstration der Erweiterbarkeit der Architektur

Die Module implementieren das gemeinsame `IModule`-Interface und werden über die `ModuleRegistry` registriert und initialisiert. Dadurch sind die Module voneinander getrennt und können unabhängig erweitert werden.