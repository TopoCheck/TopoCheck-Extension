import { AclProtocol } from "../../models/ciscoProtocols";
import { NetworkDevice } from "../../models/networkDevice";

/** Renders the validated ACL from the router's saved device configuration. */
export class AclConfigGenerator {
    public generate(device: NetworkDevice, protocol: AclProtocol, interfaceCommands: Map<string, string[]>): string[] {
        const blocks: string[] = [];
        for (const { name, rules, binding } of protocol.configurations) {
            blocks.push([
                `ip access-list extended ${name}`,
                ...rules.map((rule) =>
                    ` ${rule.action} ip ${formatAddress(rule.source, rule.sourceWildcard)} ${formatAddress(rule.destination, rule.destinationWildcard)}`),
                " exit"
            ].join("\n"));

            if (!binding) { continue; }
            const iface = device.findInterface(binding.interfaceId);
            if (!iface) {
                throw new Error(`Das Interface der ACL „${name}“ ist auf ${device.hostname} nicht vorhanden.`);
            }
            const commands = interfaceCommands.get(iface.name) ?? [];
            commands.push(` ip access-group ${name} ${binding.direction}`);
            interfaceCommands.set(iface.name, commands);
        }
        return blocks;
    }
}

function formatAddress(address: string, wildcard: string): string {
    if (address === "any") { return address; }
    return wildcard ? `${address} ${wildcard}` : `host ${address}`;
}
