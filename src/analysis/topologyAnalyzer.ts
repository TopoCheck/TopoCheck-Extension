import { NetworkInterface } from "../models/networkInterface";
import { NetworkTopology } from "../models/networkTopology";

export enum TopologyIssueCode {
  DeviceWithoutInterface = "DEVICE_WITHOUT_INTERFACE",
  InterfaceWithoutIpConfiguration = "INTERFACE_WITHOUT_IP_CONFIGURATION",
  DuplicateIpAddress = "DUPLICATE_IP_ADDRESS",
  DeviceWithoutConnection = "DEVICE_WITHOUT_CONNECTION"
}

export interface TopologyIssue {
  code: TopologyIssueCode;
  message: string;
  deviceId?: string;
  interfaceId?: string;
}

interface IpAddressOwner {
  deviceId: string;
  networkInterface: NetworkInterface;
}

/**
 * Examines a topology without changing it and returns all detected issues.
 */
export function analyzeTopology(topology: NetworkTopology): TopologyIssue[] {
  const issues: TopologyIssue[] = [];
  const ipAddressOwners = new Map<string, IpAddressOwner>();

  for (const device of topology.devices) {
    if (device.interfaces.length === 0) {
      issues.push({
        code: TopologyIssueCode.DeviceWithoutInterface,
        message: `Device "${device.hostname}" has no network interfaces.`,
        deviceId: device.id
      });
    }

    if (!topology.connections.some((connection) => connection.usesDevice(device.id))) {
      issues.push({
        code: TopologyIssueCode.DeviceWithoutConnection,
        message: `Device "${device.hostname}" is not connected to another device.`,
        deviceId: device.id
      });
    }

    for (const networkInterface of device.interfaces) {
      analyzeInterface(
        device.id,
        networkInterface,
        ipAddressOwners,
        issues
      );
    }
  }

  return issues;
}

function analyzeInterface(
  deviceId: string,
  networkInterface: NetworkInterface,
  ipAddressOwners: Map<string, IpAddressOwner>,
  issues: TopologyIssue[]
): void {
  if (
    networkInterface.enabled &&
    (networkInterface.ipAddress === undefined ||
      networkInterface.subnetMask === undefined)
  ) {
    issues.push({
      code: TopologyIssueCode.InterfaceWithoutIpConfiguration,
      message: `Enabled interface "${networkInterface.name}" has no complete IP configuration.`,
      deviceId,
      interfaceId: networkInterface.id
    });
  }

  if (networkInterface.ipAddress === undefined) {
    return;
  }

  const existingOwner = ipAddressOwners.get(networkInterface.ipAddress);

  if (existingOwner === undefined) {
    ipAddressOwners.set(networkInterface.ipAddress, {
      deviceId,
      networkInterface
    });
    return;
  }

  issues.push({
    code: TopologyIssueCode.DuplicateIpAddress,
    message:
      `IP address "${networkInterface.ipAddress}" is already used by ` +
      `interface "${existingOwner.networkInterface.name}" on device ` +
      `"${existingOwner.deviceId}".`,
    deviceId,
    interfaceId: networkInterface.id
  });
}
