import { DeviceType, InterfaceType, NetworkDevice, NetworkInterface } from "../models";

export interface CiscoIosParserOptions {
  /** Stable identity supplied by the caller, independent of the hostname. */
  deviceId: string;
  deviceType: DeviceType;
}

export interface ParserDiagnostic {
  /** One-based source line number. */
  line: number;
  severity: "warning" | "error";
  message: string;
}

export interface CiscoIosParseResult {
  /** Undefined when no valid hostname was found. Other errors may leave partial data. */
  device: NetworkDevice | undefined;
  diagnostics: ParserDiagnostic[];
}

/** Parse the supported IOS subset without depending on the VS Code runtime. */
export function parseCiscoConfig(
  text: string,
  options: CiscoIosParserOptions
): CiscoIosParseResult {
  const diagnostics: ParserDiagnostic[] = [];
  const interfaces = new Map<string, NetworkInterface>();
  let hostname: string | undefined;
  let currentInterface: NetworkInterface | undefined;
  // Unsupported sections must not leak their child commands into a previous interface.
  let unsupportedSection = false;
  const report = (line: number, severity: ParserDiagnostic["severity"], message: string) => {
    diagnostics.push({ line, severity, message });
  };

  if (!options.deviceId.trim() || !Object.values(DeviceType).includes(options.deviceType)) {
    report(1, "error", "A non-empty deviceId and valid deviceType are required.");
    return { device: undefined, diagnostics };
  }

  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  for (const [index, rawLine] of lines.entries()) {
    const line = index + 1;
    const command = rawLine.trim();
    if (!command) {
      continue;
    }
    if (command.startsWith("!")) {
      currentInterface = undefined;
      unsupportedSection = false;
      continue;
    }
    if (command === "end") {
      break;
    }
    if (command === "exit" || command === "configure terminal") {
      currentInterface = undefined;
      unsupportedSection = false;
      continue;
    }

    if (/^hostname(?:\s|$)/.test(command)) {
      currentInterface = undefined;
      unsupportedSection = false;
      const match = /^hostname\s+([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(command);
      if (match) {
        hostname = match[1];
      } else {
        report(line, "error", "Expected: hostname <name>.");
      }
      continue;
    }

    if (/^interface(?:\s|$)/.test(command)) {
      currentInterface = undefined;
      unsupportedSection = true;
      const match = /^interface\s+(\S+)$/.exec(command);
      if (!match) {
        report(line, "error", "Expected: interface <name>; interface ranges are not supported.");
        continue;
      }
      const name = match[1];
      const type = interfaceType(name);
      if (type === undefined) {
        report(line, "warning", `Unsupported interface: ${name}.`);
        continue;
      }
      currentInterface = interfaces.get(name);
      if (!currentInterface) {
        currentInterface = new NetworkInterface({
          id: `${options.deviceId.trim()}:${name}`, name, type
        });
        interfaces.set(name, currentInterface);
      }
      unsupportedSection = false;
      continue;
    }

    // Global unsupported sections and commands end the previous interface context.
    const interfaceCommand = /^(?:description(?:\s|$)|(?:no\s+)?shutdown(?:\s|$)|(?:no\s+)?ip\s+address(?:\s|$)|no\s+description$)/.test(command);
    if (!/^\s/.test(rawLine) && !interfaceCommand) {
      currentInterface = undefined;
      unsupportedSection = true;
    }
    if (unsupportedSection || !interfaceCommand) {
      report(line, "warning", `Unsupported command: ${command}`);
      continue;
    }
    if (!currentInterface) {
      report(line, "error", `Command requires a supported interface context: ${command}`);
      continue;
    }

    if (/^description\s+\S/.test(command)) {
      currentInterface.description = command.replace(/^description\s+/, "");
    } else if (command === "no description") {
      currentInterface.description = undefined;
    } else if (command === "shutdown") {
      currentInterface.disable();
    } else if (command === "no shutdown") {
      currentInterface.enable();
    } else if (command === "no ip address") {
      currentInterface.clearIpConfiguration();
    } else {
      const match = /^ip\s+address\s+(\S+)\s+(\S+)$/.exec(command);
      if (!match) {
        report(line, "error", `Invalid or unsupported interface syntax: ${command}`);
        continue;
      }
      if (!isSubnetMask(match[2])) {
        report(line, "error", `Invalid contiguous IPv4 subnet mask: ${match[2]}`);
        continue;
      }
      try {
        currentInterface.setIpConfiguration(match[1], match[2]);
      } catch (error) {
        report(line, "error", error instanceof Error ? error.message : "Invalid IP configuration.");
      }
    }
  }

  if (!hostname) {
    report(1, "error", "No valid hostname found; a device cannot be created.");
    return { device: undefined, diagnostics };
  }
  const device = new NetworkDevice({
    id: options.deviceId, hostname, type: options.deviceType
  });
  for (const networkInterface of interfaces.values()) {
    device.addInterface(networkInterface);
  }
  return { device, diagnostics };
}

function interfaceType(name: string): InterfaceType | undefined {
  const types: [RegExp, InterfaceType][] = [
    [/^GigabitEthernet\d+(?:\/\d+)*(?:\.\d+)?$/, InterfaceType.GigabitEthernet],
    [/^FastEthernet\d+(?:\/\d+)*(?:\.\d+)?$/, InterfaceType.FastEthernet],
    [/^Ethernet\d+(?:\/\d+)*(?:\.\d+)?$/, InterfaceType.Ethernet],
    [/^Loopback\d+$/, InterfaceType.Loopback],
    [/^Vlan\d+$/, InterfaceType.Vlan]
  ];
  return types.find(([pattern]) => pattern.test(name))?.[1];
}

function isSubnetMask(value: string): boolean {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return false;
  }
  const octets = value.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) {
    return false;
  }
  const bits = octets.map((octet) => octet.toString(2).padStart(8, "0")).join("");
  return /^1*0*$/.test(bits);
}
