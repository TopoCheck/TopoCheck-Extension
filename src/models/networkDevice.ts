import { DeviceType } from "./deviceType";
import { NetworkInterface } from "./networkInterface";
import { NetworkProtocol } from "./networkProtocol";
import { ProtocolType } from "./protocolType";

export interface NetworkDeviceData {
  id: string;
  hostname: string;
  type: DeviceType;
}

/** A router, switch or PC and the configuration assigned to it. */
export class NetworkDevice {
  public readonly id: string;
  public readonly hostname: string;
  public readonly type: DeviceType;

  private readonly interfaceList: NetworkInterface[] = [];
  private readonly protocolList: NetworkProtocol[] = [];

  public constructor(data: NetworkDeviceData) {
    this.id = requireNonEmpty(data.id, "Device ID");
    this.hostname = requireNonEmpty(data.hostname, "Hostname");
    this.type = data.type;
  }

  public get interfaces(): readonly NetworkInterface[] {
    return this.interfaceList;
  }

  public get protocols(): readonly NetworkProtocol[] {
    return this.protocolList;
  }

  public addInterface(networkInterface: NetworkInterface): void {
    if (this.interfaceList.some((item) => item.id === networkInterface.id)) {
      throw new Error(`Interface with ID "${networkInterface.id}" already exists.`);
    }

    if (this.interfaceList.some((item) => item.name === networkInterface.name)) {
      throw new Error(`Interface with name "${networkInterface.name}" already exists.`);
    }

    this.interfaceList.push(networkInterface);
  }

  public removeInterface(interfaceId: string): boolean {
    const index = this.interfaceList.findIndex((item) => item.id === interfaceId);

    if (index === -1) {
      return false;
    }

    this.interfaceList.splice(index, 1);
    return true;
  }

  public findInterface(interfaceId: string): NetworkInterface | undefined {
    return this.interfaceList.find((item) => item.id === interfaceId);
  }

  public addProtocol(protocol: NetworkProtocol): void {
    if (this.protocolList.some((item) => item.id === protocol.id)) {
      throw new Error(`Protocol with ID "${protocol.id}" already exists.`);
    }

    if (this.protocolList.some((item) => item.type === protocol.type)) {
      throw new Error(`Protocol type "${protocol.type}" already exists.`);
    }

    if (!isProtocolCompatible(this.type, protocol.type)) {
      throw new Error(
        `Protocol "${protocol.type}" is not compatible with device type "${this.type}".`
      );
    }

    this.protocolList.push(protocol);
  }

  public removeProtocol(protocolId: string): boolean {
    const index = this.protocolList.findIndex((item) => item.id === protocolId);

    if (index === -1) {
      return false;
    }

    this.protocolList.splice(index, 1);
    return true;
  }

  public findProtocol(protocolId: string): NetworkProtocol | undefined {
    return this.protocolList.find((item) => item.id === protocolId);
  }
}

const compatibleProtocols: Readonly<Record<DeviceType, readonly ProtocolType[]>> = {
  [DeviceType.Router]: [
    ProtocolType.Rip,
    ProtocolType.Ospf,
    ProtocolType.Dhcp,
    ProtocolType.StaticRoute,
    ProtocolType.Acl,
    ProtocolType.Nat,
    ProtocolType.Pat
  ],
  [DeviceType.Switch]: [
    ProtocolType.Vlan,
    ProtocolType.Stp,
    ProtocolType.Rstp,
    ProtocolType.EtherChannel,
    ProtocolType.Dhcp
  ],
  [DeviceType.Pc]: []
};

function isProtocolCompatible(
  deviceType: DeviceType,
  protocolType: ProtocolType
): boolean {
  return compatibleProtocols[deviceType].includes(protocolType);
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  return trimmedValue;
}
