import { DeviceType, InterfaceType, NetworkDevice, NetworkInterface } from "../models";
import { CiscoIosProtocolParser, isIpv4Mask, parseSwitchport } from "./ciscoIosProtocolParser";
import { expandCiscoCommand } from "./ciscoIosAbbreviations";
import { isValidIpv4Address } from "../models/ipv4";
import {
    DhcpProtocol
} from "../models/ciscoProtocols";

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
  let currentLineContext: "console" | "vty" | undefined;

  const lineCredentials = {
      consolePassword: undefined as string | undefined,
      vtyPassword: undefined as string | undefined
  };

  let enableSecret: string | undefined;
  let domainName: string | undefined;
  let noDomainLookup = false;
  let currentInterface: NetworkInterface | undefined;
  let currentDhcpPool: {
    name: string;
    network?: string;
    subnetMask?: string;
    defaultRouter?: string;
    dnsServer?: string;
} | undefined;

const dhcpProtocol = new DhcpProtocol(`${options.deviceId}:dhcp`);
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
  let pendingExcludedAddresses: string[] = [];
  const finishDhcpPool = (line: number): void => {
    if (!currentDhcpPool) {
        return;
    }

    if (
        currentDhcpPool.network &&
        currentDhcpPool.subnetMask &&
        currentDhcpPool.defaultRouter
    ) {
        const matchingInterface = [...interfaces.values()].find((item) => {
            if (!item.ipAddress || !item.subnetMask) {
                return false;
            }

            const networkAddress = item.ipAddress
                .split(".")
                .map(Number)
                .map((part, index) =>
                    part & Number(currentDhcpPool!.subnetMask!.split(".")[index])
                )
                .join(".");

            return (
                networkAddress === currentDhcpPool!.network &&
                item.ipAddress === currentDhcpPool!.defaultRouter
            );
        });

        if (!matchingInterface) {
            report(
                line,
                "error",
                `Kein passendes Interface für DHCP-Pool ${currentDhcpPool.name} gefunden.`
            );
        } else {
            dhcpProtocol.pools.push({
                name: currentDhcpPool.name,
                interfaceName: matchingInterface.name,
                dnsServer: currentDhcpPool.dnsServer,
                excludedAddresses: [...pendingExcludedAddresses]
            });
        }
    } else {
        report(
            line,
            "error",
            `DHCP-Pool ${currentDhcpPool.name} ist unvollständig.`
        );
    }

    currentDhcpPool = undefined;
    pendingExcludedAddresses = [];
};  
  for (const [index, rawLine] of lines.entries()) {
    const line = index + 1;
    let command = rawLine.trim();
    // Globale Grundkonfiguration direkt erkennen
    if (command === "no ip domain-lookup") {
        noDomainLookup = true;
        currentInterface = undefined;
        currentLineContext = undefined;
        protocolParser.resetContext();
        unsupportedSection = false;
        continue;
    }
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
    const expanded = expandCiscoCommand(command, currentInterface ? "interface" : protocolParser.context);
    console.log("Parser command:", command);
    if (expanded.error) {
      report(line, "error", expanded.error);
      // An ambiguous global header must not leave the preceding section active.
      if (!/^\s/.test(rawLine)) {
        currentInterface = undefined;
        protocolParser.resetContext();
        unsupportedSection = true;
      }
      continue;
    }
    command = expanded.command;
    if (command === "end") {
      break;
    }
    if (/^banner(?:\s|$)/.test(command)) {
        protocolParser.resetContext();
        currentInterface = undefined;
        currentLineContext = undefined;
        unsupportedSection = false;

        const match = /^banner\s+(\S+)\s+(\S)(.*)$/.exec(command);

        if (!match) {
            report(line, "error", "Ungültige Banner-Syntax.");
        } else {
            const delimiter = match[2];

            if (match[3].includes(delimiter)) {
                continue;
            }

            banner = { delimiter, line };
        }

        continue;
    }

    // Line-Konfiguration
    const lineMatch = /^line (console 0|vty 0 4)$/.exec(command);

    if (lineMatch) {
        currentInterface = undefined;
        protocolParser.resetContext();
        unsupportedSection = false;

        currentLineContext = lineMatch[1] === "console 0"
            ? "console"
            : "vty";

        continue;
    }

    if (currentLineContext) {
        const passwordMatch = /^password (\S+)$/.exec(command);

        if (passwordMatch) {
            if (currentLineContext === "console") {
                lineCredentials.consolePassword = passwordMatch[1];
            } else {
                lineCredentials.vtyPassword = passwordMatch[1];
            }

            continue;
        }

        if (command === "login") {
            continue;
        }

        if (command === "exit") {
            currentLineContext = undefined;
            continue;
        }
    }

    if (command === "exit" && currentDhcpPool) {
        finishDhcpPool(line);
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

    const domainMatch = /^ip domain-name (\S+)$/.exec(command);

    if (domainMatch) {
        domainName = domainMatch[1];
        currentInterface = undefined;
        currentLineContext = undefined;
        continue;
    }

    const secretMatch = /^enable secret (\S+)$/.exec(command);

    if (secretMatch) {
        enableSecret = secretMatch[1];
        currentInterface = undefined;
        currentLineContext = undefined;
        continue;
    }


      // DHCP excluded-address
      const excludedAddressMatch =
          /^ip dhcp excluded-address (\S+)$/.exec(command);

      if (excludedAddressMatch) {
          const address = excludedAddressMatch[1];

          if (!isValidIpv4Address(address)) {
              report(line, "error", `Ungültige DHCP-Adresse: ${address}`);
              continue;
          }

          // Die Adresse wird später dem passenden Pool zugeordnet.
          pendingExcludedAddresses.push(address);
          continue;
      }

      // DHCP pool
      const dhcpPoolMatch = /^ip dhcp pool (\S+)$/.exec(command);

      if (dhcpPoolMatch) {
          currentInterface = undefined;
          protocolParser.resetContext();
          unsupportedSection = false;

          currentDhcpPool = {
              name: dhcpPoolMatch[1]
          };

          pendingExcludedAddresses = [];
          continue;
      }

      // DHCP pool commands
      if (currentDhcpPool) {
          const networkMatch =
              /^network (\S+) (\S+)$/.exec(command);

          const routerMatch =
              /^default-router (\S+)$/.exec(command);

          const dnsMatch =
              /^dns-server (\S+)$/.exec(command);

          if (networkMatch) {
              currentDhcpPool.network = networkMatch[1];
              currentDhcpPool.subnetMask = networkMatch[2];
              continue;
          }

          if (routerMatch) {
              currentDhcpPool.defaultRouter = routerMatch[1];
              continue;
          }

          if (dnsMatch) {
              currentDhcpPool.dnsServer = dnsMatch[1];
              continue;
          }

          report(line, "warning", `Unbekannter DHCP-Befehl: ${command}`);
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
      id: options.deviceId,
      hostname,
      type: options.deviceType,
      domainName,
      enableSecret,
      consolePassword: lineCredentials.consolePassword,
      vtyPassword: lineCredentials.vtyPassword
  });
  for (const networkInterface of interfaces.values()) {
    device.addInterface(networkInterface);
  }
  for (const protocol of protocolParser.protocols) {
      device.addProtocol(protocol);
  }

  if (dhcpProtocol.pools.length > 0) {
      device.addProtocol(dhcpProtocol);
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
