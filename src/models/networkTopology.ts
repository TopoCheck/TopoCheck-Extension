import { ConnectionEndpoint } from "./connectionEndpoint";
import { NetworkConnection } from "./networkConnection";
import { NetworkDevice } from "./networkDevice";

export interface NetworkTopologyData {
  id: string;
  name: string;
}

/** Aggregate root that keeps devices and physical connections consistent. */
export class NetworkTopology {
  public readonly id: string;
  public readonly name: string;

  private readonly deviceList: NetworkDevice[] = [];
  private readonly connectionList: NetworkConnection[] = [];

  public constructor(data: NetworkTopologyData) {
    this.id = requireNonEmpty(data.id, "Topology ID");
    this.name = requireNonEmpty(data.name, "Topology name");
  }

  public get devices(): readonly NetworkDevice[] {
    return this.deviceList;
  }

  public get connections(): readonly NetworkConnection[] {
    return this.connectionList;
  }

  public addDevice(device: NetworkDevice): void {
    if (this.deviceList.some((item) => item.id === device.id)) {
      throw new Error(`Device with ID "${device.id}" already exists.`);
    }

    this.deviceList.push(device);
  }

  public removeDevice(deviceId: string): boolean {
    const index = this.deviceList.findIndex((item) => item.id === deviceId);

    if (index === -1) {
      return false;
    }

    for (let connectionIndex = this.connectionList.length - 1;
      connectionIndex >= 0;
      connectionIndex--) {
      if (this.connectionList[connectionIndex].usesDevice(deviceId)) {
        this.connectionList.splice(connectionIndex, 1);
      }
    }

    this.deviceList.splice(index, 1);
    return true;
  }

  public findDevice(deviceId: string): NetworkDevice | undefined {
    return this.deviceList.find((item) => item.id === deviceId);
  }

  public addConnection(connection: NetworkConnection): void {
    if (this.connectionList.some((item) => item.id === connection.id)) {
      throw new Error(`Connection with ID "${connection.id}" already exists.`);
    }

    if (this.connectionList.some((item) => item.connectsSameEndpoints(connection))) {
      throw new Error("A connection between these endpoints already exists.");
    }

    this.requireExistingEndpoint(connection.source);
    this.requireExistingEndpoint(connection.target);

    if (this.isInterfaceConnected(connection.source)) {
      throw new Error(
        `Interface "${connection.source.interfaceId}" on device ` +
        `"${connection.source.deviceId}" is already connected.`
      );
    }

    if (this.isInterfaceConnected(connection.target)) {
      throw new Error(
        `Interface "${connection.target.interfaceId}" on device ` +
        `"${connection.target.deviceId}" is already connected.`
      );
    }

    this.connectionList.push(connection);
  }

  public removeConnection(connectionId: string): boolean {
    const index = this.connectionList.findIndex((item) => item.id === connectionId);

    if (index === -1) {
      return false;
    }

    this.connectionList.splice(index, 1);
    return true;
  }

  public findConnection(connectionId: string): NetworkConnection | undefined {
    return this.connectionList.find((item) => item.id === connectionId);
  }

  private requireExistingEndpoint(endpoint: ConnectionEndpoint): void {
    const device = this.findDevice(endpoint.deviceId);

    if (device === undefined) {
      throw new Error(`Device with ID "${endpoint.deviceId}" does not exist.`);
    }

    if (device.findInterface(endpoint.interfaceId) === undefined) {
      throw new Error(
        `Interface with ID "${endpoint.interfaceId}" does not exist on ` +
        `device "${endpoint.deviceId}".`
      );
    }
  }

  private isInterfaceConnected(endpoint: ConnectionEndpoint): boolean {
    return this.connectionList.some((connection) =>
      connection.usesInterface(endpoint.deviceId, endpoint.interfaceId)
    );
  }
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  return trimmedValue;
}
