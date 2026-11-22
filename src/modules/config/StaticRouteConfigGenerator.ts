import { NetworkDevice } from "../../models/networkDevice";
import { StaticRouteProtocol } from "../../models/ciscoProtocols";
import { isValidIpv4Address } from "../../models/ipv4";

export class StaticRouteConfigGenerator {
    public generate(device: NetworkDevice): string {
        const staticRoutes = device.protocols.find(
            (protocol): protocol is StaticRouteProtocol =>
                protocol instanceof StaticRouteProtocol && protocol.enabled
        );

        if (!staticRoutes) {
            return "";
        }

        const configuration: string[] = [];

        for (const route of staticRoutes.routes) {
            if (
                !isValidIpv4Address(route.destination) ||
                !isValidIpv4Address(route.subnetMask)
            ) {
                throw new Error(
                    `Invalid static route: ${route.destination} ${route.subnetMask}`
                );
            }

            if (!route.nextHop && !route.outgoingInterface) {
                throw new Error(
                    `Static route to ${route.destination} requires a next hop or outgoing interface.`
                );
            }

            if (route.nextHop && !isValidIpv4Address(route.nextHop)) {
                throw new Error(`Invalid next hop: ${route.nextHop}`);
            }

            const parts = [
                "ip route",
                route.destination,
                route.subnetMask
            ];

            if (route.outgoingInterface) {
                parts.push(route.outgoingInterface);
            }

            if (route.nextHop) {
                parts.push(route.nextHop);
            }

            if (route.administrativeDistance !== undefined) {
                parts.push(String(route.administrativeDistance));
            }

            configuration.push(parts.join(" "));
        }

        return configuration.join("\n");
    }
}