/**
 * Automatische Switching-Konfiguration
 * Eingabe- und Ausgabetypen des Switching-Generators.
*/

import type { ConnectionEndpoint } from "../../models/connectionEndpoint";
import type { SwitchportConfiguration, VlanConfiguration } from "../../models/ciscoProtocols";
import type { DeviceType } from "../../models/deviceType";
import type { InterfaceType } from "../../models/interfaceType";
import type { ProtocolType } from "../../models/protocolType";


// Eingabe

export interface SwitchingVlan {
    id: number;
    name: string;
}

/**
 * auto   = Generator entscheidet nach Praxisregeln
 * access = vom Benutzer erzwungen
 * trunk  = vom Benutzer erzwungen
*/
export type PortMode = "auto" | "access" | "trunk";

export interface SwitchingInterfaceInput {
    id: string;
    name: string;
    type: InterfaceType;
    accessVlan?: number;
    portMode?: PortMode;
    subinterfaceVlans?: number[];
}

export interface SwitchingDeviceInput {
    id: string;
    hostname: string;
    type: DeviceType;
    protocols: ProtocolType[];
    interfaces: SwitchingInterfaceInput[];
}

export interface SwitchingConnectionInput {
    id: string;
    a: ConnectionEndpoint;
    b: ConnectionEndpoint;
}

export interface SwitchingTopologyInput {
    vlans: SwitchingVlan[];
    nativeVlan?: number;
    devices: SwitchingDeviceInput[];
    connections: SwitchingConnectionInput[];
}

export interface SwitchingOptions {
    blackholeVlan: number;
    primaryRootPriority: number;
    secondaryRootPriority: number;
    maxChannelMembers: number;
}

export const DEFAULT_NATIVE_VLAN = 99;

export const DEFAULT_SWITCHING_OPTIONS: SwitchingOptions = {
    blackholeVlan: 999,
    primaryRootPriority: 4096,
    secondaryRootPriority: 8192,
    maxChannelMembers: 8
};


// Ausgabe (Soll-Modell)

export type PortRole = "access" | "trunk" | "channel-member" | "unused";

export interface PortPlan {
    interfaceId: string;
    name: string;
    role: PortRole;
    description?: string;
    switchport?: SwitchportConfiguration;
    nonegotiate: boolean;
    channelGroup?: number;
    portfast: boolean;
    bpduGuard: boolean;
    shutdown: boolean;
}

export interface PortChannelPlan {
    number: number;
    peerDeviceId: string;
    peerHostname: string;
    memberInterfaceIds: string[];
    lacpMode: "active";
    switchport?: SwitchportConfiguration;
    nonegotiate: boolean;
}

export type StpMode = "rapid-pvst" | "pvst";
export type RootRole = "primary" | "secondary" | "none";

export interface StpPlan {
    mode: StpMode;
    rootRole: RootRole;
    priority?: number;
    vlans: number[];
}

export interface SwitchPlan {
    deviceId: string;
    hostname: string;
    vlanEnabled: boolean;
    vlans: VlanConfiguration[];
    stp: StpPlan;
    portChannels: PortChannelPlan[];
    ports: PortPlan[];
}

export type SwitchingWarningCode =
    | "VLAN_INVALID"
    | "VLAN_DUPLICATE"
    | "VLAN_RESERVED"
    | "VLAN_NAME_ADJUSTED"
    | "VLAN_NOT_ENABLED"
    | "ACCESS_VLAN_MISSING"
    | "ACCESS_VLAN_UNKNOWN"
    | "ACCESS_VLAN_IS_NATIVE"
    | "TRUNK_TO_END_DEVICE"
    | "TRUNK_TO_ROUTER_WITHOUT_SUBINTERFACES"
    | "ACCESS_BETWEEN_SWITCHES"
    | "STP_DEFAULTED"
    | "STP_MODE_MIXED"
    | "ETHERCHANNEL_TYPE_MISMATCH"
    | "ETHERCHANNEL_TOO_MANY_LINKS"
    | "ETHERCHANNEL_DISABLED_ON_PEER";

export interface SwitchingWarning {
    code: SwitchingWarningCode;
    message: string;
    deviceId?: string;
    interfaceId?: string;
}

export interface SwitchingPlan {
    switches: SwitchPlan[];
    warnings: SwitchingWarning[];
}
