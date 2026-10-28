import { ProtocolType } from "./protocolType";

export interface NetworkProtocolData {
  id: string;
  type: ProtocolType;
  enabled?: boolean;
}

/** Common representation shared by all supported network protocols. */
export class NetworkProtocol {
  public readonly id: string;
  public readonly type: ProtocolType;
  public enabled: boolean;

  public constructor(data: NetworkProtocolData) {
    const trimmedId = data.id.trim();

    if (trimmedId.length === 0) {
      throw new Error("Protocol ID must not be empty.");
    }

    this.id = trimmedId;
    this.type = data.type;
    this.enabled = data.enabled ?? true;
  }

  public enable(): void {
    this.enabled = true;
  }

  public disable(): void {
    this.enabled = false;
  }
}
