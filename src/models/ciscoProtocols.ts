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

export interface DhcpPoolConfiguration {
  name: string;
  interfaceName: string;
  dnsServer?: string;
  excludedAddresses?: string[];
}

export class DhcpProtocol extends NetworkProtocol {
  public readonly pools: DhcpPoolConfiguration[] = [];
  public constructor(id: string) {
    super({ id, type: ProtocolType.Dhcp });
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

export interface RipNetworkConfiguration {
  address: string;
}

export class RipProtocol extends NetworkProtocol {
    public readonly networks: RipNetworkConfiguration[] = [];
    public version: 1 | 2 = 2;
    public noAutoSummary = true;

    public constructor(id: string) {
        super({ id, type: ProtocolType.Rip });
    }
}

export interface Ipv4AclRule {
  action: "permit" | "deny";
  source: string;
  sourceWildcard: string;
  destination: string;
  destinationWildcard: string;
}

export interface Ipv4AclConfiguration {
  name: string;
  rules: Ipv4AclRule[];
  binding?: { interfaceId: string; direction: "in" | "out" };
}

export const MAX_IPV4_ACL_RULES = 1024;
export const MAX_IPV4_ACLS = 64;

export class AclProtocol extends NetworkProtocol {
  public constructor(id: string, enabled: boolean, public readonly configurations: Ipv4AclConfiguration[]) {
    super({ id, enabled, type: ProtocolType.Acl });
  }
}

export interface StaticNatMapping {
  localAddress: string;
  globalAddress: string;
}

export interface NatInterfaceRoles {
  insideInterfaceId: string;
  outsideInterfaceId: string;
}

export interface StaticNatConfiguration extends NatInterfaceRoles {
  mappings: StaticNatMapping[];
}

export interface PatConfiguration extends NatInterfaceRoles {
  aclName: string;
}

export const MAX_STATIC_NAT_MAPPINGS = 1024;

export class NatProtocol extends NetworkProtocol {
  public constructor(id: string, enabled: boolean, public readonly configuration: StaticNatConfiguration) {
    super({ id, enabled, type: ProtocolType.Nat });
  }
}

export class PatProtocol extends NetworkProtocol {
  public constructor(id: string, enabled: boolean, public readonly configuration: PatConfiguration) {
    super({ id, enabled, type: ProtocolType.Pat });
  }
}

export interface SwitchportConfiguration {
  mode?: "access" | "trunk";
  accessVlan?: number;
  nativeVlan?: number;
  /** Undefined means IOS default (all VLANs); [] means none. */
  allowedVlans?: number[];
}

