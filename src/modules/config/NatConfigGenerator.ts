import { NatProtocol } from "../../models/ciscoProtocols";
import { NetworkDevice } from "../../models/networkDevice";

/** Generates IOS one-to-one mappings from the router's validated NAT settings. */
export class NatConfigGenerator {
    public generate(device: NetworkDevice, protocol: NatProtocol, interfaceCommands: Map<string, string[]>): string[] {
        const { insideInterfaceId, outsideInterfaceId, mappings } = protocol.configuration;
        const inside = device.findInterface(insideInterfaceId);
        const outside = device.findInterface(outsideInterfaceId);
        if (!inside || !outside) {
            throw new Error(`Die NAT-Interfaces von ${device.hostname} sind nicht verfügbar.`);
        }
        interfaceCommands.set(inside.name, [...(interfaceCommands.get(inside.name) ?? []), " ip nat inside"]);
        interfaceCommands.set(outside.name, [...(interfaceCommands.get(outside.name) ?? []), " ip nat outside"]);

        return mappings.map(({ localAddress, globalAddress }) =>
            `ip nat inside source static ${localAddress} ${globalAddress}`);
    }
}
