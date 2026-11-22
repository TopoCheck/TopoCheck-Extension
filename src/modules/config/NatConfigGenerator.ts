import { NatInterfaceRoles, NatProtocol, PatProtocol } from "../../models/ciscoProtocols";
import { NetworkDevice } from "../../models/networkDevice";

/** Generates IOS NAT and PAT commands from the router's validated settings. */
export class NatConfigGenerator {
    public generate(device: NetworkDevice, protocol: NatProtocol, interfaceCommands: Map<string, string[]>): string[] {
        this.addInterfaceRoles(device, protocol.configuration, interfaceCommands);
        return protocol.configuration.mappings.map(({ localAddress, globalAddress }) =>
            `ip nat inside source static ${localAddress} ${globalAddress}`);
    }

    public generatePat(device: NetworkDevice, protocol: PatProtocol, interfaceCommands: Map<string, string[]>): string {
        const outsideName = this.addInterfaceRoles(device, protocol.configuration, interfaceCommands);
        return `ip nat inside source list ${protocol.configuration.aclName} interface ${outsideName} overload`;
    }

    private addInterfaceRoles(
        device: NetworkDevice,
        { insideInterfaceId, outsideInterfaceId }: NatInterfaceRoles,
        interfaceCommands: Map<string, string[]>
    ): string {
        const inside = device.findInterface(insideInterfaceId);
        const outside = device.findInterface(outsideInterfaceId);
        if (!inside || !outside) {
            throw new Error(`Die NAT-Interfaces von ${device.hostname} sind nicht verfügbar.`);
        }
        for (const [name, command] of [[inside.name, " ip nat inside"], [outside.name, " ip nat outside"]]) {
            const commands = interfaceCommands.get(name) ?? [];
            if (!commands.includes(command)) {
                commands.push(command);
                interfaceCommands.set(name, commands);
            }
        }
        return outside.name;
    }
}
