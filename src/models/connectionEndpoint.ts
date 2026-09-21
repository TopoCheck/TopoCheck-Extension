/** Identifies one device interface used by a network connection. */
export interface ConnectionEndpoint {
  readonly deviceId: string;
  readonly interfaceId: string;
}
