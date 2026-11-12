/**
 * Automatische Switching-Konfiguration: Planungsstufe
 */

import type { SwitchportConfiguration, VlanConfiguration } from "../../models/ciscoProtocols";
import { DeviceType } from "../../models/deviceType";
import { ProtocolType } from "../../models/protocolType";
import {
  DEFAULT_NATIVE_VLAN,
  DEFAULT_SWITCHING_OPTIONS,
  PortChannelPlan,
  PortPlan,
  StpMode,
  SwitchingDeviceInput,
  SwitchingInterfaceInput,
  SwitchingOptions,
  SwitchingPlan,
  SwitchingTopologyInput,
  SwitchingVlan,
  SwitchingWarning,
  SwitchPlan
} from "./types";

const RESERVED_VLANS = new Set([1002, 1003, 1004, 1005]);
const MAX_VLAN_NAME_LENGTH = 32;

interface Endpoint {
  device: SwitchingDeviceInput;
  iface: SwitchingInterfaceInput;
}

interface Context {
  input: SwitchingTopologyInput;
  options: SwitchingOptions;
  nativeVlan: number;
  userVlans: VlanConfiguration[];
  userVlanIds: Set<number>;
  peers: Map<string, Endpoint>;
  warnings: SwitchingWarning[];
}

export function planSwitching(
  input: SwitchingTopologyInput,
  options: Partial<SwitchingOptions> = {}
): SwitchingPlan {
  const opts: SwitchingOptions = { ...DEFAULT_SWITCHING_OPTIONS, ...options };
  const warnings: SwitchingWarning[] = [];
  const nativeVlan = input.nativeVlan ?? DEFAULT_NATIVE_VLAN;
  const userVlans = normalizeVlans(input.vlans, opts.blackholeVlan, warnings);

  const ctx: Context = {
    input,
    options: opts,
    nativeVlan,
    userVlans,
    userVlanIds: new Set(userVlans.map((vlan) => vlan.vlanId)),
    peers: buildPeerIndex(input),
    warnings
  };

  const switches = input.devices
    .filter((device) => device.type === DeviceType.Switch)
    .sort((a, b) => naturalCompare(a.hostname, b.hostname));

  // Port-Rollen
  const plans = new Map<string, SwitchPlan>();
  for (const device of switches) {
    plans.set(device.id, planSwitch(device, ctx));
  }

  // EtherChannel
  planEtherChannels(switches, plans, ctx);

  // STP/RSTP
  planSpanningTree(switches, plans, ctx);

  return { switches: switches.map((device) => plans.get(device.id)!), warnings };
}


// VLANs
function normalizeVlans(
  vlans: readonly SwitchingVlan[],
  blackholeVlan: number,
  warnings: SwitchingWarning[]
): VlanConfiguration[] {
  const result: VlanConfiguration[] = [];
  const seen = new Set<number>();

  for (const vlan of vlans) {
    if (!Number.isInteger(vlan.id) || vlan.id < 1 || vlan.id > 4094) {
      warnings.push({ code: "VLAN_INVALID", message: `VLAN ${vlan.id} liegt nicht im Bereich 1–4094 und wird ignoriert.` });
      continue;
    }
    if (vlan.id === 1) {
      // VLAN 1 existiert immer und kann nicht umbenannt werden
      continue;
    }
    if (RESERVED_VLANS.has(vlan.id) || vlan.id === blackholeVlan) {
      const reason = vlan.id === blackholeVlan ? "ist für ungenutzte Ports reserviert" : "ist von Cisco reserviert";
      warnings.push({ code: "VLAN_RESERVED", message: `VLAN ${vlan.id} ${reason} und wird ignoriert.` });
      continue;
    }
    if (seen.has(vlan.id)) {
      warnings.push({ code: "VLAN_DUPLICATE", message: `VLAN ${vlan.id} ist mehrfach definiert; nur die erste Definition wird verwendet.` });
      continue;
    }
    seen.add(vlan.id);

    const name = sanitizeVlanName(vlan.name, vlan.id);
    if (name !== vlan.name) {
      warnings.push({ code: "VLAN_NAME_ADJUSTED", message: `VLAN-Name "${vlan.name}" wurde zu "${name}" angepasst (IOS: max. 32 Zeichen, keine Leerzeichen).` });
    }
    result.push({ vlanId: vlan.id, name });
  }

  return result.sort((a, b) => a.vlanId - b.vlanId);
}

function sanitizeVlanName(name: string, id: number): string {
  const cleaned = name.trim().replace(/\s+/g, "_").slice(0, MAX_VLAN_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : `VLAN${String(id).padStart(4, "0")}`;
}

function switchVlans(ctx: Context): VlanConfiguration[] {
  const list = [...ctx.userVlans];
  if (ctx.nativeVlan !== 1 && !ctx.userVlanIds.has(ctx.nativeVlan)) {
    list.push({ vlanId: ctx.nativeVlan, name: "NATIVE" });
  }
  list.push({ vlanId: ctx.options.blackholeVlan, name: "BLACKHOLE" });
  return list.sort((a, b) => a.vlanId - b.vlanId);
}


// Port-Rollen
function planSwitch(device: SwitchingDeviceInput, ctx: Context): SwitchPlan {
  const vlanEnabled = device.protocols.includes(ProtocolType.Vlan);
  if (!vlanEnabled) {
    ctx.warnings.push({
      code: "VLAN_NOT_ENABLED",
      message: `Auf ${device.hostname} ist das VLAN-Protokoll nicht aktiviert – es werden keine VLANs und Switchport-Einstellungen erzeugt.`,
      deviceId: device.id
    });
  }

  const ports = [...device.interfaces]
    .sort((a, b) => naturalCompare(a.name, b.name))
    .map((iface) => planPort(device, iface, vlanEnabled, ctx));

  return {
    deviceId: device.id,
    hostname: device.hostname,
    vlanEnabled,
    vlans: vlanEnabled ? switchVlans(ctx) : [],
    stp: { mode: "rapid-pvst", rootRole: "none", vlans: [] }, // wird in Schritt 4 gesetzt
    portChannels: [],
    ports
  };
}

// Praxisregeln
function planPort(
  device: SwitchingDeviceInput,
  iface: SwitchingInterfaceInput,
  vlanEnabled: boolean,
  ctx: Context
): PortPlan {
  const peer = ctx.peers.get(key(device.id, iface.id));
  const base = { interfaceId: iface.id, name: iface.name };

  if (!peer) {
    return {
      ...base,
      role: "unused",
      description: "UNUSED",
      switchport: vlanEnabled ? { mode: "access", accessVlan: ctx.options.blackholeVlan } : undefined,
      nonegotiate: false,
      portfast: false,
      bpduGuard: false,
      shutdown: true
    };
  }

  const peerHasSubinterfaces = (peer.iface.subinterfaceVlans?.length ?? 0) > 0;
  const mode = resolveMode(iface.portMode ?? "auto", peer, peerHasSubinterfaces);
  const description = `Link to ${peer.device.hostname} ${peer.iface.name}`;
  const warn = (code: SwitchingWarning["code"], message: string) =>
    ctx.warnings.push({ code, message: `${device.hostname} ${iface.name}: ${message}`, deviceId: device.id, interfaceId: iface.id });

  if (mode === "trunk") {
    if (peer.device.type === DeviceType.Pc) {
      warn("TRUNK_TO_END_DEVICE", "Trunk zu einem Endgerät – PCs verstehen in der Regel keine 802.1Q-Tags.");
    }
    if (peer.device.type === DeviceType.Router && !peerHasSubinterfaces) {
      warn("TRUNK_TO_ROUTER_WITHOUT_SUBINTERFACES", `Trunk zu ${peer.device.hostname}, der Router hat aber keine Subinterfaces (Router-on-a-Stick fehlt).`);
    }
    const allowed = peer.device.type === DeviceType.Router && peerHasSubinterfaces
      ? peer.iface.subinterfaceVlans!.filter((id) => ctx.userVlanIds.has(id))
      : [...ctx.userVlanIds];
    return {
      ...base,
      role: "trunk",
      description,
      switchport: vlanEnabled ? trunkSwitchport(allowed, ctx.nativeVlan) : undefined,
      nonegotiate: vlanEnabled,
      portfast: false,
      bpduGuard: false,
      shutdown: false
    };
  }

  // Access
  if (peer.device.type === DeviceType.Switch) {
    warn("ACCESS_BETWEEN_SWITCHES", `Access-Port zu ${peer.device.hostname} – über diesen Link wird nur ein VLAN übertragen.`);
  }
  const accessVlan = vlanEnabled ? resolveAccessVlan(iface, ctx, warn) : undefined;
  const edge = peer.device.type === DeviceType.Pc;
  return {
    ...base,
    role: "access",
    description,
    switchport: vlanEnabled ? { mode: "access", ...(accessVlan !== undefined ? { accessVlan } : {}) } : undefined,
    nonegotiate: false,
    portfast: edge,
    bpduGuard: edge,
    shutdown: false
  };
}

function resolveMode(requested: "auto" | "access" | "trunk", peer: Endpoint, peerHasSubinterfaces: boolean): "access" | "trunk" {
  if (requested !== "auto") {
    return requested;
  }
  switch (peer.device.type) {
    case DeviceType.Switch: return "trunk";
    case DeviceType.Router: return peerHasSubinterfaces ? "trunk" : "access";
    default: return "access";
  }
}

function resolveAccessVlan(
  iface: SwitchingInterfaceInput,
  ctx: Context,
  warn: (code: SwitchingWarning["code"], message: string) => void
): number | undefined {
  const vlan = iface.accessVlan;
  if (vlan === undefined || vlan === 1) {
    warn("ACCESS_VLAN_MISSING", "Kein VLAN zugewiesen – der Port bleibt im Default-VLAN 1.");
    return undefined;
  }
  if (vlan === ctx.nativeVlan) {
    warn("ACCESS_VLAN_IS_NATIVE", `VLAN ${vlan} ist das Native VLAN der Trunks und sollte nicht für Endgeräte verwendet werden.`);
    return vlan;
  }
  if (!ctx.userVlanIds.has(vlan)) {
    warn("ACCESS_VLAN_UNKNOWN", `VLAN ${vlan} ist nicht definiert – der Port bleibt im Default-VLAN 1.`);
    return undefined;
  }
  return vlan;
}

function trunkSwitchport(allowed: number[], nativeVlan: number): SwitchportConfiguration {
  const allowedVlans = [...new Set([...allowed, nativeVlan])].sort((a, b) => a - b);
  return { mode: "trunk", nativeVlan, allowedVlans };
}


// EtherChannel
interface SwitchLink {
  local: PortPlan;
  remote: PortPlan;
  localType: string;
  remoteType: string;
}


// EtherChannel

function planEtherChannels(
  switches: readonly SwitchingDeviceInput[],
  plans: Map<string, SwitchPlan>,
  ctx: Context
): void {
  const byId = new Map(switches.map((device) => [device.id, device]));
  const pairs = new Map<string, { a: SwitchingDeviceInput; b: SwitchingDeviceInput; links: SwitchLink[] }>();

  for (const connection of ctx.input.connections) {
    let a = byId.get(connection.a.deviceId);
    let b = byId.get(connection.b.deviceId);
    if (!a || !b || a.id === b.id) {
      continue;
    }
    let aEnd = connection.a;
    let bEnd = connection.b;
    if (naturalCompare(a.hostname, b.hostname) > 0) {
      [a, b, aEnd, bEnd] = [b, a, bEnd, aEnd];
    }
    const local = plans.get(a.id)!.ports.find((port) => port.interfaceId === aEnd.interfaceId);
    const remote = plans.get(b.id)!.ports.find((port) => port.interfaceId === bEnd.interfaceId);
    if (!local || !remote || local.role !== "trunk" || remote.role !== "trunk") {
      continue;
    }
    const pairKey = `${a.id}|${b.id}`;
    const entry = pairs.get(pairKey) ?? { a, b, links: [] };
    entry.links.push({
      local,
      remote,
      localType: a.interfaces.find((i) => i.id === aEnd.interfaceId)!.type,
      remoteType: b.interfaces.find((i) => i.id === bEnd.interfaceId)!.type
    });
    pairs.set(pairKey, entry);
  }

  const sortedPairs = [...pairs.values()].sort((x, y) =>
    naturalCompare(x.a.hostname, y.a.hostname) || naturalCompare(x.b.hostname, y.b.hostname));

  for (const { a, b, links } of sortedPairs) {
    if (links.length < 2) {
      continue;
    }
    const aEnabled = a.protocols.includes(ProtocolType.EtherChannel);
    const bEnabled = b.protocols.includes(ProtocolType.EtherChannel);
    if (!aEnabled && !bEnabled) {
      continue;
    }
    if (!aEnabled || !bEnabled) {
      const off = aEnabled ? b : a;
      ctx.warnings.push({
        code: "ETHERCHANNEL_DISABLED_ON_PEER",
        message: `${a.hostname} und ${b.hostname} haben ${links.length} parallele Links, EtherChannel ist aber auf ${off.hostname} nicht aktiviert.`,
        deviceId: off.id
      });
      continue;
    }
    const types = new Set(links.flatMap((link) => [link.localType, link.remoteType]));
    if (types.size > 1) {
      ctx.warnings.push({
        code: "ETHERCHANNEL_TYPE_MISMATCH",
        message: `Links zwischen ${a.hostname} und ${b.hostname} haben unterschiedliche Interface-Typen – kein EtherChannel möglich.`,
        deviceId: a.id
      });
      continue;
    }

    links.sort((x, y) => naturalCompare(x.local.name, y.local.name));
    let members = links;
    if (links.length > ctx.options.maxChannelMembers) {
      members = links.slice(0, ctx.options.maxChannelMembers);
      ctx.warnings.push({
        code: "ETHERCHANNEL_TOO_MANY_LINKS",
        message: `Zwischen ${a.hostname} und ${b.hostname} bestehen ${links.length} Links; nur ${ctx.options.maxChannelMembers} werden gebündelt.`,
        deviceId: a.id
      });
    }

    const planA = plans.get(a.id)!;
    const planB = plans.get(b.id)!;
    const number = nextFreeChannel(planA, planB);
    planA.portChannels.push(buildChannel(number, b, members.map((link) => link.local)));
    planB.portChannels.push(buildChannel(number, a, members.map((link) => link.remote)));
  }
}

function nextFreeChannel(a: SwitchPlan, b: SwitchPlan): number {
  const used = new Set([...a.portChannels, ...b.portChannels].map((channel) => channel.number));
  let number = 1;
  while (used.has(number)) {
    number++;
  }
  return number;
}

function buildChannel(number: number, peer: SwitchingDeviceInput, members: PortPlan[]): PortChannelPlan {
  for (const port of members) {
    port.role = "channel-member";
    port.channelGroup = number;
    port.description = `Po${number} member - ${port.description ?? ""}`.trim();
  }
  const template = members[0];
  return {
    number,
    peerDeviceId: peer.id,
    peerHostname: peer.hostname,
    memberInterfaceIds: members.map((port) => port.interfaceId),
    lacpMode: "active",
    switchport: template.switchport,
    nonegotiate: template.nonegotiate
  };
}