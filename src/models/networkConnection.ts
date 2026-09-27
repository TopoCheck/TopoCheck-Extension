import { ConnectionEndpoint } from "./connectionEndpoint";

export interface NetworkConnectionData {
  id: string;
  source: ConnectionEndpoint;
  target: ConnectionEndpoint;
}

/** A physical connection between two device interfaces. */
export class NetworkConnection {
  public readonly id: string;
  public readonly source: ConnectionEndpoint;
  public readonly target: ConnectionEndpoint;

  public constructor(data: NetworkConnectionData) {
    this.id = requireNonEmpty(data.id, "Connection ID");
    this.source = copyEndpoint(data.source, "Source");
    this.target = copyEndpoint(data.target, "Target");

    if (endpointsEqual(this.source, this.target)) {
      throw new Error("A network interface cannot be connected to itself.");
    }
  }

  public usesDevice(deviceId: string): boolean {
    return this.source.deviceId === deviceId || this.target.deviceId === deviceId;
  }

  public usesInterface(deviceId: string, interfaceId: string): boolean {
    return (
      (this.source.deviceId === deviceId && this.source.interfaceId === interfaceId) ||
      (this.target.deviceId === deviceId && this.target.interfaceId === interfaceId)
    );
  }

  public connectsSameEndpoints(other: NetworkConnection): boolean {
    return (
      (endpointsEqual(this.source, other.source) &&
        endpointsEqual(this.target, other.target)) ||
      (endpointsEqual(this.source, other.target) &&
        endpointsEqual(this.target, other.source))
    );
  }
}

function copyEndpoint(
  endpoint: ConnectionEndpoint,
  fieldName: string
): ConnectionEndpoint {
  return Object.freeze({
    deviceId: requireNonEmpty(endpoint.deviceId, `${fieldName} device ID`),
    interfaceId: requireNonEmpty(endpoint.interfaceId, `${fieldName} interface ID`)
  });
}

function endpointsEqual(
  first: ConnectionEndpoint,
  second: ConnectionEndpoint
): boolean {
  return first.deviceId === second.deviceId &&
    first.interfaceId === second.interfaceId;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  return trimmedValue;
}
