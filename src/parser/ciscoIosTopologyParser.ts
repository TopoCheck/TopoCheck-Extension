import { NetworkDevice, NetworkTopology, NetworkTopologyData } from "../models";
import { CiscoIosParserOptions, ParserDiagnostic, parseCiscoConfig } from "./ciscoIosParser";

export interface CiscoIosConfiguration extends CiscoIosParserOptions {
  text: string;
}

export interface ConfigurationDiagnostic extends ParserDiagnostic {
  deviceId: string;
}

export interface CiscoIosTopologyParseResult {
  /** No topology is returned if any input contains an error. */
  topology: NetworkTopology | undefined;
  diagnostics: ConfigurationDiagnostic[];
}

/** Build an H1c topology without modifying an existing plan or inventing physical links. */
export function parseCiscoTopology(
  configurations: readonly CiscoIosConfiguration[],
  topologyData: NetworkTopologyData
): CiscoIosTopologyParseResult {
  const diagnostics: ConfigurationDiagnostic[] = [];
  const devices: NetworkDevice[] = [];
  const deviceIds = new Set<string>();

  for (const configuration of configurations) {
    const deviceId = configuration.deviceId.trim();
    const result = parseCiscoConfig(configuration.text, configuration);
    diagnostics.push(...result.diagnostics.map((diagnostic) => ({ ...diagnostic, deviceId })));
    if (deviceIds.has(deviceId)) {
      diagnostics.push({
        deviceId, line: 1, severity: "error",
        message: `Duplicate device ID: ${deviceId}`
      });
    }
    deviceIds.add(deviceId);
    if (result.device) {
      devices.push(result.device);
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { topology: undefined, diagnostics };
  }

  // Invalid topology metadata is a caller error, validated by the H1c constructor.
  const topology = new NetworkTopology(topologyData);
  for (const device of devices) {
    topology.addDevice(device);
  }
  return { topology, diagnostics };
}
