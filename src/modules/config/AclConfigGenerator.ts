import { AclProtocol } from "../../models/ciscoProtocols";
import { NetworkDevice } from "../../models/networkDevice";

/** Renders the validated ACL from the router's saved device configuration. */
export class AclConfigGenerator {
    public generate(device: NetworkDevice, protocol: AclProtocol): string {
        const { name, rules, binding } = protocol.configuration;
        const lines = [
            `ip access-list extended ${name}`,
            ...rules.map((rule) =>
                ` ${rule.action} ip ${formatAddress(rule.source, rule.sourceWildcard)} ${formatAddress(rule.destination, rule.destinationWildcard)}`),
            " exit"
        ];

        if (binding) {
            const iface = device.findInterface(binding.interfaceId);
            if (!iface) {
                throw new Error(`Das Interface der ACL „${name}“ ist auf ${device.hostname} nicht vorhanden.`);
            }
            lines.push(`interface ${iface.name}`, ` ip access-group ${name} ${binding.direction}`, " exit");
        }

        return lines.join("\n");
    }
}

function formatAddress(address: string, wildcard: string): string {
    if (address === "any") { return address; }
    return wildcard ? `${address} ${wildcard}` : `host ${address}`;
}
