# Cisco-IOS-Parser – erster Schritt von H1e

`src/parser` exportiert `parseCiscoConfig(text, options)`. Der Aufrufer übergibt
eine stabile `deviceId` und den bekannten `deviceType`. Das Ergebnis enthält
`device` (H1c-`NetworkDevice`) und `diagnostics` mit einsbasierten Zeilennummern,
Schweregrad und Meldung. Ohne gültigen Hostnamen entsteht kein Gerät.

```typescript
import { parseCiscoConfig } from "./parser";
import { DeviceType } from "./models";

const result = parseCiscoConfig(configurationText, {
  deviceId: "router-1",
  deviceType: DeviceType.Router
});
```

Unterstützt: `hostname`, `interface`, `description`, `no description`,
statische IPv4-Adressen mit zusammenhängender Subnetzmaske (`ip address`),
`no ip address`, `shutdown`, `no shutdown`. Interface-Kategorien:
Ethernet, FastEthernet, GigabitEthernet, Loopback und Vlan.
`!`, `exit` und `configure terminal` beenden den Interface-Kontext;
`end` beendet die Verarbeitung. Erneute Blöcke desselben Interfaces aktualisieren
dessen Werte. Fehlende Zustände verwenden die H1c-Vorgabe (`enabled: true`),
keine gerätespezifischen Defaults.

Unbekannte Befehle und Abschnitte erzeugen Warnungen. Fehlerhafte unterstützte
Befehle erzeugen Fehler; gültige vorherige Werte bleiben erhalten. Auch bei
vorhandenem Gerät müssen Aufrufer die Diagnosen prüfen, da Teilergebnisse
möglich sind. Die Schnittstelle ist unabhängig von VS Code.

Noch nicht umgesetzt: Dateizugriffe, Editor-Anbindung, VLAN-Definitionen,
Switchports, Routingprotokolle, statische Routen, DHCP-Adressen, sekundäre
IP-Adressen und mehrzeilige Banner. Der bisherige Editor-Validator bleibt
unverändert. Die fünf vollständigen Testkonfigurationsdateien und das
abschließende Review für die gesamte H1e-Aufgabe stehen noch aus.
