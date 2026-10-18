import { DeviceType, InterfaceType, NetworkDevice, NetworkInterface } from "../models";
import { CiscoIosProtocolParser, isIpv4Mask, parseSwitchport } from "./ciscoIosProtocolParser";

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
  /** Source command, when the diagnostic refers to a configuration line. */
  command?: string;
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
  let banner: { delimiter: string; line: number } | undefined;
  let lines: string[] = [];
  const report = (line: number, severity: ParserDiagnostic["severity"], message: string) => {
    diagnostics.push({ line, severity, message, command: lines[line - 1]?.trim() });
  };

  if (typeof text !== "string") {
    report(1, "error", "Der Konfigurationsinhalt muss als Text übergeben werden.");
    return { device: undefined, diagnostics };
  }
  lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  if (!options || typeof options.deviceId !== "string" || !options.deviceId.trim() ||
    !Object.values(DeviceType).includes(options.deviceType)) {
    report(1, "error", "Eine nicht leere Geräte-ID und ein gültiger Gerätetyp sind erforderlich.");
    return { device: undefined, diagnostics };
  }
  if (lines.every((line) => !line.trim())) {
    report(1, "error", "Die Konfiguration ist leer.");
    return { device: undefined, diagnostics };
  }
  const protocolParser = new CiscoIosProtocolParser(options.deviceType, options.deviceId.trim());
  for (const [index, rawLine] of lines.entries()) {
    const line = index + 1;
    const command = rawLine.trim();
    if (banner) {
      if (command.includes(banner.delimiter)) {
        banner = undefined;
      }
      continue;
    }
    if (!command) {
      continue;
    }
    if (command.startsWith("!")) {
      protocolParser.resetContext();
      currentInterface = undefined;
      unsupportedSection = false;
      continue;
    }
    if (command === "end") {
      break;
    }
    if (/^banner(?:\s|$)/.test(command)) {
      protocolParser.resetContext();
      currentInterface = undefined;
      unsupportedSection = false;
      const match = /^banner\s+\S+\s+(\^.|\S)(.*)$/.exec(command);
      if (!match) {
        report(line, "error", "Erwartet: banner <Typ> <Trennzeichen>Text<Trennzeichen>.");
      } else {
        report(line, "warning", "Banner werden nicht ausgewertet; ihr Inhalt wird übersprungen.");
        if (!match[2].includes(match[1])) {
          banner = { delimiter: match[1], line };
        }
      }
      continue;
    }
    if (command === "exit" || command === "configure terminal") {
      protocolParser.resetContext();
      currentInterface = undefined;
      unsupportedSection = false;
      continue;
    }

    if (/^hostname(?:\s|$)/.test(command)) {
      protocolParser.resetContext();
      currentInterface = undefined;
      unsupportedSection = false;
      const match = /^hostname\s+([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(command);
      if (match) {
        hostname = match[1];
      } else {
        report(line, "error", "Erwartet: hostname <Name> mit Buchstaben, Ziffern, Punkt, Bindestrich oder Unterstrich.");
      }
      continue;
    }

    if (/^interface(?:\s|$)/.test(command)) {
      protocolParser.resetContext();
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

    if (protocolParser.parse(command, /^\s/.test(rawLine),
      (severity, message) => report(line, severity, message))) {
      currentInterface = undefined;
      unsupportedSection = false;
      continue;
    }

    // Global unsupported sections and commands end the previous interface context.
    const interfaceCommand = /^(?:description(?:\s|$)|(?:no\s+)?switchport(?:\s|$)|(?:no\s+)?shutdown(?:\s|$)|(?:no\s+)?ip\s+address(?:\s|$)|no\s+description$)/.test(command);
    if (!/^\s/.test(rawLine) && !interfaceCommand) {
      currentInterface = undefined;
      unsupportedSection = true;
    }
    if (unsupportedSection || !interfaceCommand) {
      report(line, "warning", `Unbekannter oder nicht unterstützter Befehl: ${command}`);
      continue;
    }
    if (!currentInterface) {
      report(line, "error", `Dieser Befehl benötigt einen gültigen Interface-Abschnitt: ${command}`);
      continue;
    }

    if (/^(?:no\s+)?switchport(?:\s|$)/.test(command)) {
      parseSwitchport(command, currentInterface, options.deviceType,
        (severity, message) => report(line, severity, message));
    } else if (/^description\s+\S/.test(command)) {
      currentInterface.description = command.replace(/^description\s+/, "");
    } else if (/^no\s+description$/.test(command)) {
      currentInterface.description = undefined;
    } else if (command === "shutdown") {
      currentInterface.disable();
    } else if (/^no\s+shutdown$/.test(command)) {
      currentInterface.enable();
    } else if (/^no\s+ip\s+address$/.test(command)) {
      currentInterface.clearIpConfiguration();
    } else {
      const match = /^ip\s+address\s+(\S+)\s+(\S+)$/.exec(command);
      if (!match) {
        const expected = /^description/.test(command) ? "description <Text>" :
          /shutdown/.test(command) ? "shutdown oder no shutdown" :
            "ip address <IPv4-Adresse> <Subnetzmaske> oder no ip address";
        report(line, "error", `Ungültige Interface-Syntax. Erwartet: ${expected}.`);
        continue;
      }
      if (!isIpv4Mask(match[2])) {
        report(line, "error", `Ungültige IPv4-Subnetzmaske: ${match[2]}. Die gesetzten Bits müssen zusammenhängend sein.`);
        continue;
      }
      try {
        currentInterface.setIpConfiguration(match[1], match[2]);
      } catch (error) {
        report(line, "error", error instanceof Error ? error.message : "Invalid IP configuration.");
      }
    }
  }

  if (banner) {
    report(banner.line, "error", `Banner ist nicht abgeschlossen; Trennzeichen ${banner.delimiter} fehlt.`);
  }
  if (!hostname) {
    report(1, "error", "Kein gültiger hostname-Befehl gefunden; das Gerät kann nicht erstellt werden.");
    return { device: undefined, diagnostics };
  }
  const device = new NetworkDevice({
    id: options.deviceId, hostname, type: options.deviceType
  });
  for (const networkInterface of interfaces.values()) {
    device.addInterface(networkInterface);
  }
  for (const protocol of protocolParser.protocols) {
    device.addProtocol(protocol);
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
