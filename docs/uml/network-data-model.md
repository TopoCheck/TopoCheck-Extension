# UML-Klassendiagramm: Netzwerk-Datenmodell

Dieses Diagramm bildet H1c einschließlich der Protokollerweiterungen aus H1e ab.

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
        +string? description
        +SwitchportConfiguration? switchport
        +boolean enabled
        +string? ipAddress
        +string? subnetMask
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
        +connectsSameEndpoints(other) boolean
    }

    class VlanProtocol {
        +VlanConfiguration[] vlans
    }
    class VlanConfiguration {
        +number vlanId
        +string? name
    }
    class StaticRouteProtocol {
        +StaticRouteConfiguration[] routes
    }
    class StaticRouteConfiguration {
        +string destination
        +string subnetMask
        +string? nextHop
        +string? outgoingInterface
        +number? administrativeDistance
    }
    class OspfProtocol {
        +OspfProcessConfiguration[] processes
    }
    class OspfProcessConfiguration {
        +number processId
        +string? routerId
        +OspfNetworkConfiguration[] networks
        +boolean passiveInterfaceDefault
        +Record~string,boolean~ passiveInterfaces
    }
    class OspfNetworkConfiguration {
        +string address
        +string wildcardMask
        +string area
    }
    class SwitchportConfiguration {
        +string? mode
        +number? accessVlan
        +number? nativeVlan
        +number[] allowedVlans
    }

    class TopologyAnalyzer {
        <<module>>
        +analyzeTopology(topology) TopologyIssue[]
    }

    class TopologyIssue {
        <<interface>>
        +TopologyIssueCode code
        +string message
        +string? deviceId
        +string? interfaceId
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
    NetworkProtocol <|-- VlanProtocol
    NetworkProtocol <|-- StaticRouteProtocol
    NetworkProtocol <|-- OspfProtocol
    VlanProtocol *-- VlanConfiguration
    StaticRouteProtocol *-- StaticRouteConfiguration
    OspfProtocol *-- OspfProcessConfiguration
    OspfProcessConfiguration *-- OspfNetworkConfiguration
    NetworkInterface --> SwitchportConfiguration
    TopologyAnalyzer ..> NetworkTopology : analyzes
    TopologyAnalyzer ..> TopologyIssue : returns
```

## Beziehungserklärung

- Eine Topologie enthält beliebig viele Geräte und Verbindungen.
- Ein Gerät besitzt seine Interfaces und aktivierten Protokolle.
- Eine Verbindung enthält genau zwei Endpunkte.
- Ein Endpunkt verweist über IDs auf ein Gerät und eines seiner Interfaces.
- Enums begrenzen Geräte-, Interface- und Protokolltypen auf bekannte Werte.
- Der TopologyAnalyzer konsumiert das Modell und liefert strukturierte Issues.

## Konsistenzprüfung nach Implementierung

- [x] Alle dargestellten Klassen und Enums existieren im Code.
- [x] Namen und Typen der öffentlichen Eigenschaften stimmen überein.
- [x] Öffentliche Methoden stimmen mit der Implementierung überein.
- [x] Kardinalitäten entsprechen der tatsächlichen Modelllogik.
- [x] Die H1e-Protokoll- und Interface-Erweiterungen sind dargestellt.

