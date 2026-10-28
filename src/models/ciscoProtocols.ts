import { NetworkProtocol } from "./networkProtocol";
import { ProtocolType } from "./protocolType";

export interface VlanConfiguration {
  vlanId: number;
  name?: string;
}

export class VlanProtocol extends NetworkProtocol {
  public readonly vlans: VlanConfiguration[] = [];
  public constructor(id: string) {
    super({ id, type: ProtocolType.Vlan });
  }
}

export interface StaticRouteConfiguration {
  destination: string;
  subnetMask: string;
  nextHop?: string;
  outgoingInterface?: string;
  administrativeDistance?: number;
}

export class StaticRouteProtocol extends NetworkProtocol {
  public readonly routes: StaticRouteConfiguration[] = [];
  public constructor(id: string) {
    super({ id, type: ProtocolType.StaticRoute });
  }
}

export interface OspfNetworkConfiguration {
  address: string;
  wildcardMask: string;
  area: string;
}

export interface OspfProcessConfiguration {
  processId: number;
  routerId?: string;
  networks: OspfNetworkConfiguration[];
  passiveInterfaceDefault: boolean;
  /** Explicit overrides of passive-interface default, keyed by interface name. */
  passiveInterfaces: Record<string, boolean>;
}

/** Multiple IOS processes share one H1c protocol type per device. */
export class OspfProtocol extends NetworkProtocol {
  public readonly processes: OspfProcessConfiguration[] = [];
  public constructor(id: string) {
    super({ id, type: ProtocolType.Ospf });
  }
}

export interface SwitchportConfiguration {
  mode?: "access" | "trunk";
  accessVlan?: number;
  nativeVlan?: number;
  /** Undefined means IOS default (all VLANs); [] means none. */
  allowedVlans?: number[];
}
