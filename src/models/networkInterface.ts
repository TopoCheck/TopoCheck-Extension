import { InterfaceType } from "./interfaceType";

export interface NetworkInterfaceData {
  id: string;
  name: string;
  type: InterfaceType;
  enabled?: boolean;
  ipAddress?: string;
  subnetMask?: string;
}

/** A configurable interface owned by a network device. */
export class NetworkInterface {
  public readonly id: string;
  public readonly name: string;
  public readonly type: InterfaceType;
  public enabled: boolean;
  public ipAddress: string | undefined;
  public subnetMask: string | undefined;

  public constructor(data: NetworkInterfaceData) {
    this.id = requireNonEmpty(data.id, "Interface ID");
    this.name = requireNonEmpty(data.name, "Interface name");
    this.type = data.type;
    this.enabled = data.enabled ?? true;

    if (data.ipAddress === undefined && data.subnetMask === undefined) {
      return;
    }

    if (data.ipAddress === undefined || data.subnetMask === undefined) {
      throw new Error("IP address and subnet mask must be provided together.");
    }

    this.setIpConfiguration(data.ipAddress, data.subnetMask);
  }

  public setIpConfiguration(ipAddress: string, subnetMask: string): void {
    if (!isValidIpv4Address(ipAddress)) {
      throw new Error(`Invalid IPv4 address: ${ipAddress}`);
    }

    if (!isValidIpv4Address(subnetMask)) {
      throw new Error(`Invalid subnet mask: ${subnetMask}`);
    }

    this.ipAddress = ipAddress;
    this.subnetMask = subnetMask;
  }

  public clearIpConfiguration(): void {
    this.ipAddress = undefined;
    this.subnetMask = undefined;
  }

  public enable(): void {
    this.enabled = true;
  }

  public disable(): void {
    this.enabled = false;
  }
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  return trimmedValue;
}

function isValidIpv4Address(value: string): boolean {
  const octets = value.split(".");

  return octets.length === 4 && octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) {
      return false;
    }

    const numericValue = Number(octet);
    return numericValue >= 0 && numericValue <= 255;
  });
}
