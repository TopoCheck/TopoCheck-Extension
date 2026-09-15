# UML-Klassendiagramm: Netzwerk-Datenmodell

Dieses Diagramm ist der geplante Stand für Subziel H1.c. Nach der
Implementierung muss es mit den tatsächlichen Klassen synchronisiert werden.

```mermaid
classDiagram
    direction LR

    class NetworkTopology {
        -NetworkDevice[] deviceList
        -NetworkConnection[] connectionList
        +string id
        +string name
        +NetworkDevice[] devices
        +NetworkConnection[] connections
        +addDevice(device) void
        +removeDevice(deviceId) boolean
        +findDevice(deviceId) NetworkDevice
        +addConnection(connection) void
        +removeConnection(connectionId) boolean
        +findConnection(connectionId) NetworkConnection
    }

    class NetworkDevice {
        -NetworkInterface[] interfaceList
        -NetworkProtocol[] protocolList
        +string id
        +string hostname
        +DeviceType type
        +NetworkInterface[] interfaces
        +NetworkProtocol[] protocols
        +addInterface(networkInterface) void
        +removeInterface(interfaceId) boolean
        +findInterface(interfaceId) NetworkInterface
        +addProtocol(protocol) void
        +removeProtocol(protocolId) boolean
        +findProtocol(protocolId) NetworkProtocol
    }

    class NetworkInterface {
        +string id
        +string name
        +InterfaceType type
        +boolean enabled
        +string ipAddress
        +string subnetMask
        +setIpConfiguration(ipAddress, subnetMask) void
        +clearIpConfiguration() void
        +enable() void
        +disable() void
    }

    class NetworkProtocol {
        +string id
        +ProtocolType type
        +boolean enabled
        +enable() void
        +disable() void
    }

    class NetworkConnection {
        +string id
        +ConnectionEndpoint source
        +ConnectionEndpoint target
        +usesDevice(deviceId) boolean
        +usesInterface(deviceId, interfaceId) boolean
    }

    class ConnectionEndpoint {
        <<interface>>
        +string deviceId
        +string interfaceId
    }

    class DeviceType {
        <<enumeration>>
        Router
        Switch
        Pc
    }

    class InterfaceType {
        <<enumeration>>
        Ethernet
        GigabitEthernet
        FastEthernet
        Loopback
        Vlan
    }

    class ProtocolType {
        <<enumeration>>
        Rip
        Ospf
        Vlan
        Stp
        Rstp
        EtherChannel
        Dhcp
        StaticRoute
        Acl
        Nat
        Pat
    }

    NetworkTopology "1" *-- "0..*" NetworkDevice : contains
    NetworkTopology "1" *-- "0..*" NetworkConnection : contains
    NetworkDevice "1" *-- "0..*" NetworkInterface : owns
    NetworkDevice "1" *-- "0..*" NetworkProtocol : enables
    NetworkConnection "1" *-- "2" ConnectionEndpoint : endpoints
    NetworkDevice --> DeviceType : has type
    NetworkInterface --> InterfaceType : has type
    NetworkProtocol --> ProtocolType : has type
```

## Beziehungserklärung

- Eine Topologie enthält beliebig viele Geräte und Verbindungen.
- Ein Gerät besitzt seine Interfaces und aktivierten Protokolle.
- Eine Verbindung enthält genau zwei Endpunkte.
- Ein Endpunkt verweist über IDs auf ein Gerät und eines seiner Interfaces.
- Enums begrenzen Geräte-, Interface- und Protokolltypen auf bekannte Werte.

## Konsistenzprüfung nach Implementierung

- [ ] Alle dargestellten Klassen und Enums existieren im Code.
- [ ] Namen und Typen der öffentlichen Eigenschaften stimmen überein.
- [ ] Öffentliche Methoden stimmen mit der Implementierung überein.
- [ ] Kardinalitäten entsprechen der tatsächlichen Modelllogik.
- [ ] Änderungen aus dem Code-Review wurden im Diagramm nachgezogen.

