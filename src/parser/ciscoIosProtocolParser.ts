import {
  DeviceType, NetworkInterface, NetworkProtocol, OspfProcessConfiguration,
  OspfProtocol, StaticRouteConfiguration, StaticRouteProtocol, VlanConfiguration, VlanProtocol
} from "../models";

export type ReportDiagnostic = (severity: "warning" | "error", message: string) => void;

/** Stateful parser for the explicitly supported protocol subset. */
export class CiscoIosProtocolParser {
  private readonly vlan: VlanProtocol;
  private readonly ospf: OspfProtocol;
  private readonly routes: StaticRouteProtocol;
  private currentVlan: VlanConfiguration | undefined;
  private currentOspf: OspfProcessConfiguration | undefined;
  private blocked = false;

  public constructor(private readonly deviceType: DeviceType, deviceId: string) {
    this.vlan = new VlanProtocol(`${deviceId}:vlan`);
    this.ospf = new OspfProtocol(`${deviceId}:ospf`);
    this.routes = new StaticRouteProtocol(`${deviceId}:static-route`);
  }

  public resetContext(): void {
    this.currentVlan = undefined;
    this.currentOspf = undefined;
    this.blocked = false;
  }

  public get context(): "vlan" | "ospf" | "global" {
    return this.currentVlan ? "vlan" : this.currentOspf ? "ospf" : "global";
  }

  public get protocols(): NetworkProtocol[] {
    return [
      ...(this.vlan.vlans.length ? [this.vlan] : []),
      ...(this.ospf.processes.length ? [this.ospf] : []),
      ...(this.routes.routes.length ? [this.routes] : [])
    ];
  }

  /** True when this parser owns the command and its context. */
  public parse(command: string, indented: boolean, report: ReportDiagnostic): boolean {
    if (/^vlan(?:\s|$)/.test(command)) {
      this.resetContext();
      this.blocked = true;
      if (this.deviceType !== DeviceType.Switch) {
        report("error", "VLAN definitions require a switch in the H1c model.");
        return true;
      }
      const match = /^vlan\s+(\d+)$/.exec(command);
      if (!match || !integerInRange(match[1], 1, 4094)) {
        report("error", "Expected: vlan <1-4094>; ranges are not supported.");
        return true;
      }
      const vlanId = Number(match[1]);
      this.currentVlan = this.vlan.vlans.find((vlan) => vlan.vlanId === vlanId);
      if (!this.currentVlan) {
        this.currentVlan = { vlanId };
        this.vlan.vlans.push(this.currentVlan);
      }
      this.blocked = false;
      return true;
    }
    if (/^router\s+ospf(?:\s|$)/.test(command)) {
      this.resetContext();
      this.blocked = true;
      const match = /^router\s+ospf\s+(\d+)$/.exec(command);
      if (this.deviceType !== DeviceType.Router) {
        report("error", "OSPF requires a router in the H1c model.");
      } else if (!match || !integerInRange(match[1], 1, 65535)) {
        report("error", "Expected: router ospf <1-65535>; VRFs are not supported.");
      } else {
        const processId = Number(match[1]);
        this.currentOspf = this.ospf.processes.find((process) => process.processId === processId);
        if (!this.currentOspf) {
          this.currentOspf = {
            processId, networks: [], passiveInterfaceDefault: false, passiveInterfaces: {}
          };
          this.ospf.processes.push(this.currentOspf);
        }
        this.blocked = false;
      }
      return true;
    }
    if (/^ip\s+route(?:\s|$)/.test(command)) {
      this.resetContext();
      if (this.deviceType !== DeviceType.Router) {
        report("error", "Static routes require a router in the H1c model.");
      } else {
        this.parseRoute(command, report);
      }
      return true;
    }

    const childCommand = /^(?:name|network|router-id|(?:no\s+)?passive-interface)(?:\s|$)/.test(command);
    if (!indented && !childCommand) {
      this.resetContext();
    }
    if (this.blocked) {
      report("warning", `Unsupported command in rejected section: ${command}`);
      return true;
    }
    if (this.currentVlan) {
      const match = /^name\s+(\S+)$/.exec(command);
      if (match && match[1].length <= 32) {
        this.currentVlan.name = match[1];
      } else {
        report(/^name(?:\s|$)/.test(command) ? "error" : "warning", `Invalid or unsupported VLAN command: ${command}`);
      }
      return true;
    }
    if (this.currentOspf) {
      this.parseOspf(command, this.currentOspf, report);
      return true;
    }
    if (childCommand) {
      report("error", `Der Befehl benötigt einen passenden VLAN- oder OSPF-Abschnitt: ${command}`);
      return true;
    }
    return false;
  }

  private parseRoute(command: string, report: ReportDiagnostic): void {
    const tokens = command.split(/\s+/).slice(2);
    const [destination, subnetMask] = tokens;
    if (!isIpv4(destination ?? "") || !isIpv4Mask(subnetMask ?? "")) {
      report("error", "Static route requires a valid IPv4 destination and contiguous subnet mask.");
      return;
    }
    const destinationOctets = destination.split(".").map(Number);
    const maskOctets = subnetMask.split(".").map(Number);
    if (destinationOctets.some((octet, index) => (octet & maskOctets[index]) !== octet)) {
      report("error", "Static route destination has host bits set.");
      return;
    }
    const route: StaticRouteConfiguration = { destination, subnetMask };
    let index = 2;
    if (isInterfaceName(tokens[index] ?? "")) {
      route.outgoingInterface = tokens[index++];
    }
    if (isIpv4(tokens[index] ?? "")) {
      route.nextHop = tokens[index++];
    }
    if (!route.nextHop && !route.outgoingInterface) {
      report("error", "Static route requires a next-hop IPv4 address or supported outgoing interface.");
      return;
    }
    if (tokens[index] !== undefined && integerInRange(tokens[index], 1, 255)) {
      route.administrativeDistance = Number(tokens[index++]);
    }
    if (index !== tokens.length) {
      report("error", "Invalid or unsupported static route options.");
      return;
    }
    if (!this.routes.routes.some((existing) => JSON.stringify(existing) === JSON.stringify(route))) {
      this.routes.routes.push(route);
    }
  }

  private parseOspf(command: string, process: OspfProcessConfiguration, report: ReportDiagnostic): void {
    let match = /^router-id\s+(\S+)$/.exec(command);
    if (match && isIpv4(match[1])) {
      process.routerId = match[1];
      return;
    }
    match = /^network\s+(\S+)\s+(\S+)\s+area\s+(\S+)$/.exec(command);
    if (match && isIpv4(match[1]) && isWildcardMask(match[2]) && isArea(match[3])) {
      const area = normalizeArea(match[3]);
      const network = { address: match[1], wildcardMask: match[2], area };
      if (!process.networks.some((item) => JSON.stringify(item) === JSON.stringify(network))) {
        process.networks.push(network);
      }
      return;
    }
    match = /^(no\s+)?passive-interface\s+(\S+)$/.exec(command);
    if (match && (match[2] === "default" || isInterfaceName(match[2]))) {
      if (match[2] === "default") {
        process.passiveInterfaceDefault = !match[1];
      } else {
        process.passiveInterfaces[match[2]] = !match[1];
      }
      return;
    }
    if (/^router-id(?:\s|$)/.test(command)) {
      report("error", "Ungültige OSPF-Router-ID. Erwartet: router-id <gültige IPv4-Adresse>.");
    } else if (/^network(?:\s|$)/.test(command)) {
      report("error", "Ungültiges OSPF-Netzwerk. Erwartet: network <IPv4-Adresse> <zusammenhängende Wildcard-Maske> area <0-4294967295 oder IPv4-Schreibweise>.");
    } else if (/^(?:no\s+)?passive-interface(?:\s|$)/.test(command)) {
      report("error", "Erwartet: [no] passive-interface <unterstützter Interface-Name oder default>.");
    } else {
      report("warning", `Nicht unterstützter OSPF-Befehl: ${command}`);
    }
  }
}

export function parseSwitchport(command: string, networkInterface: NetworkInterface,
  deviceType: DeviceType, report: ReportDiagnostic): void {
  if (deviceType !== DeviceType.Switch) {
    report("error", "Switchport commands require a switch in the H1c model.");
    return;
  }
  if (/^no\s+switchport$/.test(command)) {
    networkInterface.switchport = undefined;
    return;
  }
  const settings = networkInterface.switchport ?? {};
  let match = /^switchport\s+mode\s+(access|trunk)$/.exec(command);
  if (match) {
    settings.mode = match[1] as "access" | "trunk";
  } else if ((match = /^switchport\s+(access\s+vlan|trunk\s+native\s+vlan)\s+(\d+)$/.exec(command))) {
    if (!integerInRange(match[2], 1, 4094)) {
      report("error", "VLAN ID must be between 1 and 4094.");
      return;
    }
    if (match[1].startsWith("access")) {
      settings.accessVlan = Number(match[2]);
    } else {
      settings.nativeVlan = Number(match[2]);
    }
  } else if ((match = /^switchport\s+trunk\s+allowed\s+vlan\s+(?:(add|remove|except)\s+)?(\S+)$/.exec(command))) {
    const operation = match[1];
    const value = match[2];
    const vlans = parseVlanList(value);
    if (!vlans || (operation && (value === "all" || value === "none"))) {
      report("error", "Invalid trunk VLAN list; expected IDs/ranges from 1 to 4094.");
      return;
    }
    const all = () => Array.from({ length: 4094 }, (_, index) => index + 1);
    const previous = settings.allowedVlans ?? all();
    if (operation === "add") {
      settings.allowedVlans = [...new Set([...previous, ...vlans])].sort((a, b) => a - b);
    } else if (operation === "remove") {
      const removed = new Set(vlans);
      settings.allowedVlans = previous.filter((vlan) => !removed.has(vlan));
    } else if (operation === "except") {
      const excluded = new Set(vlans);
      settings.allowedVlans = all().filter((vlan) => !excluded.has(vlan));
    } else {
      settings.allowedVlans = value === "all" ? undefined : vlans;
    }
  } else if (command !== "switchport") {
    const known = /^switchport\s+(?:mode|access\s+vlan|trunk\s+(?:native\s+vlan|allowed\s+vlan))(?:\s|$)/.test(command);
    report(known ? "error" : "warning", `Invalid or unsupported switchport command: ${command}`);
    return;
  }
  networkInterface.switchport = settings;
}

function parseVlanList(value: string): number[] | undefined {
  if (value === "all") {
    return Array.from({ length: 4094 }, (_, index) => index + 1);
  }
  if (value === "none") {
    return [];
  }
  const vlans = new Set<number>();
  for (const item of value.split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(item);
    if (!match || !integerInRange(match[1], 1, 4094) ||
      (match[2] !== undefined && !integerInRange(match[2], Number(match[1]), 4094))) {
      return undefined;
    }
    for (let vlan = Number(match[1]); vlan <= Number(match[2] ?? match[1]); vlan++) {
      vlans.add(vlan);
    }
  }
  return [...vlans].sort((a, b) => a - b);
}

function integerInRange(value: string, minimum: number, maximum: number): boolean {
  return /^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= maximum;
}

export function isIpv4(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split(".").every((octet) => Number(octet) <= 255);
}

export function isIpv4Mask(value: string): boolean {
  return isIpv4(value) && /^1*0*$/.test(ipBits(value));
}

function isWildcardMask(value: string): boolean {
  return isIpv4(value) && /^0*1*$/.test(ipBits(value));
}

function ipBits(value: string): string {
  return value.split(".").map((octet) => Number(octet).toString(2).padStart(8, "0")).join("");
}

function isArea(value: string): boolean {
  return integerInRange(value, 0, 4294967295) || isIpv4(value);
}

function normalizeArea(value: string): string {
  return isIpv4(value) ? String(value.split(".").reduce((result, octet) => result * 256 + Number(octet), 0)) : String(Number(value));
}

function isInterfaceName(value: string): boolean {
  return /^(?:(?:GigabitEthernet|FastEthernet|Ethernet|Serial)\d+(?:\/\d+)*(?:\.\d+)?|(?:Loopback|Vlan|Null)\d+)$/.test(value);
}
