import { NetworkDevice } from "../../models/networkDevice";
import { DeviceType } from "../../models/deviceType";
import { DhcpProtocol } from "../../models/ciscoProtocols";
import { isValidIpv4Address } from "../../models/ipv4";

export class DhcpConfigGenerator {
    public generate(device: NetworkDevice): string {
        if (device.type !== DeviceType.Router) {
            throw new Error("DHCP configuration is only supported for routers.");
        }

        const dhcp = device.protocols.find(
            (protocol): protocol is DhcpProtocol =>
                protocol instanceof DhcpProtocol && protocol.enabled
        );

        if (!dhcp) {
            return "";
        }

        const configuration: string[] = [];

        for (const pool of dhcp.pools) {
            const networkInterface = device.interfaces.find(
                (item) => item.name === pool.interfaceName
            );

            if (!networkInterface) {
                throw new Error(
                    `DHCP interface "${pool.interfaceName}" was not found.`
                );
            }

            if (!networkInterface.ipAddress || !networkInterface.subnetMask) {
                throw new Error(
                    `DHCP interface "${pool.interfaceName}" has no IP configuration.`
                );
            }

            if (!networkInterface.enabled) {
                throw new Error(
                    `DHCP interface "${pool.interfaceName}" is disabled.`
                );
            }

            if (!isValidIpv4Address(pool.dnsServer ?? "") && pool.dnsServer) {
                throw new Error(`Invalid DNS server: ${pool.dnsServer}`);
            }

            if (configuration.length > 0) { configuration.push(""); }

            for (const address of pool.excludedAddresses ?? []) {
                if (!isValidIpv4Address(address)) {
                    throw new Error(`Invalid excluded address: ${address}`);
                }

                configuration.push(`ip dhcp excluded-address ${address}`);
            }

            const networkAddress = this.calculateNetworkAddress(
                networkInterface.ipAddress,
                networkInterface.subnetMask
            );

            configuration.push(`ip dhcp pool ${pool.name}`);
            configuration.push(
                ` network ${networkAddress} ${networkInterface.subnetMask}`
            );
            configuration.push(
                ` default-router ${networkInterface.ipAddress}`
            );

            if (pool.dnsServer) {
                configuration.push(` dns-server ${pool.dnsServer}`);
            }

            configuration.push(" exit");
        }

        return configuration.join("\n");
    }

    private calculateNetworkAddress(ipAddress: string, subnetMask: string): string {
        const ipParts = ipAddress.split(".").map(Number);
        const maskParts = subnetMask.split(".").map(Number);

        return ipParts
            .map((part, index) => part & maskParts[index])
            .join(".");
    }
}
