
import { DeviceType } from "../../models/deviceType";
import { NetworkDevice } from "../../models/networkDevice";
import { RipProtocol } from "../../models/ciscoProtocols";
import { isValidIpv4Address } from "../../models/ipv4";

export class RipConfigGenerator {
    public generate(device: NetworkDevice): string {
        if (device.type !== DeviceType.Router) {
            throw new Error(
                `RIP configuration can only be generated for routers.`
            );
        }

        const ripProtocol = device.protocols.find(
            (protocol): protocol is RipProtocol =>
                protocol instanceof RipProtocol
        );

        if (ripProtocol === undefined || !ripProtocol.enabled) {
            throw new Error(
                `RIP is not enabled on device "${device.hostname}".`
            );
        }

        const networks = new Set<string>();

        for (const configuredNetwork of ripProtocol.networks) {
            if (!isValidIpv4Address(configuredNetwork.address)) {
                throw new Error(
                    `Invalid RIP network address: ${configuredNetwork.address}`
                );
            }

            networks.add(configuredNetwork.address);
        }

        if (networks.size === 0) {
            throw new Error(
                `No valid networks found for RIP on device "${device.hostname}".`
            );
        }

        const lines = [
            "router rip",
            " version 2",
            " no auto-summary",
            ...Array.from(networks)
                .sort()
                .map((network) => ` network ${network}`)
        ];

        return lines.join("\n");
    }
}
