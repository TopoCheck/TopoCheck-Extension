
import { DeviceType } from "../../models/deviceType";
import { NetworkDevice } from "../../models/networkDevice";
import { OspfProtocol } from "../../models/ciscoProtocols";
import {
    isValidIpv4Address,
    isValidSubnetMask
} from "../../models/ipv4";

export class OspfConfigGenerator {
    public generate(device: NetworkDevice): string {
        if (device.type !== DeviceType.Router) {
            throw new Error(
                "OSPF configuration can only be generated for routers."
            );
        }

        const ospfProtocol = device.protocols.find(
            (protocol): protocol is OspfProtocol =>
                protocol instanceof OspfProtocol
        );

        if (ospfProtocol === undefined || !ospfProtocol.enabled) {
            throw new Error(
                `OSPF is not enabled on device "${device.hostname}".`
            );
        }

        if (ospfProtocol.processes.length === 0) {
            throw new Error(
                `No OSPF processes configured on device "${device.hostname}".`
            );
        }

        const lines: string[] = [];

        for (const process of ospfProtocol.processes) {
            if (
                !Number.isInteger(process.processId) ||
                process.processId < 1 ||
                process.processId > 65535
            ) {
                throw new Error(
                    `Invalid OSPF process ID: ${process.processId}`
                );
            }

            if (
                process.routerId !== undefined &&
                !isValidIpv4Address(process.routerId)
            ) {
                throw new Error(
                    `Invalid OSPF router ID: ${process.routerId}`
                );
            }

            const allNetworks = new Map<
                string,
                {
                    address: string;
                    wildcardMask: string;
                    area: string;
                }
            >();

            for (const network of process.networks) {
                allNetworks.set(
                    `${network.address}/${network.wildcardMask}/${network.area}`,
                    network
                );
            }

            if (allNetworks.size === 0) {
                throw new Error(
                    `OSPF process ${process.processId} has no networks.`
                );
            }

            lines.push(`router ospf ${process.processId}`);

            if (process.routerId !== undefined) {
                lines.push(` router-id ${process.routerId}`);
            }

            if (process.passiveInterfaceDefault) {
                lines.push(" passive-interface default");
            }

            for (const [interfaceName, isPassive] of Object.entries(
                process.passiveInterfaces
            )) {
                lines.push(
                    ` ${isPassive ? "passive-interface" : "no passive-interface"} ${interfaceName}`
                );
            }

            for (const network of allNetworks.values()) {
                if (
                    !isValidIpv4Address(network.address) ||
                    !isValidIpv4Address(network.wildcardMask) ||
                    !/^\d+$/.test(network.area) ||
                    Number(network.area) < 0 ||
                    Number(network.area) > 4294967295
                ) {
                    throw new Error(
                        `Invalid OSPF network configuration in process ${process.processId}.`
                    );
                }

                lines.push(
                    ` network ${network.address} ${network.wildcardMask} area ${network.area}`
                );
            }
        }

        return lines.join("\n");
    }

}
