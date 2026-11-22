
import { IModule } from "../../core/interfaces/IModule";
import { TopologyStore } from "../topology/TopologyStore";
import { RipConfigGenerator } from "./RipConfigGenerator";
import { OspfConfigGenerator } from "./OspfConfigGenerator";
import { BasicConfigGenerator } from "./BasicConfigGenerator";
import { DhcpConfigGenerator } from "./DhcpConfigGenerator";
import { StaticRouteConfigGenerator } from "./StaticRouteConfigGenerator";
import {
    RipProtocol,
    OspfProtocol,
    DhcpProtocol,
    StaticRouteProtocol, 
} from "../../models/ciscoProtocols";

export class ConfigModule implements IModule {
    name = "config";

    private readonly ripGenerator = new RipConfigGenerator();
    private readonly ospfGenerator = new OspfConfigGenerator();
    private readonly basicGenerator = new BasicConfigGenerator();
    private readonly dhcpGenerator = new DhcpConfigGenerator();
    private readonly staticRouteGenerator = new StaticRouteConfigGenerator();
    constructor(private readonly store: TopologyStore) { }

    initialize(): void {
        console.log("Config module initialized");
    }

    async generateForTopology(topologyId: string): Promise<number> {
        const topology = await this.store.loadTopology(topologyId);
        const routers = topology.devices.filter(
            device => device.type === "router"
        );

        let generatedCount = 0;

        for (const router of routers) {
            const device = await this.store.loadNetworkDevice(
                topologyId,
                router.id
            );

            const configurations: string[] = [
                this.basicGenerator.generate(device)
            ];

            const ripEnabled = device.protocols.some(
                protocol => protocol instanceof RipProtocol && protocol.enabled
            );

            const ospfEnabled = device.protocols.some(
                protocol => protocol instanceof OspfProtocol && protocol.enabled
            );

            const dhcpEnabled = device.protocols.some(
                protocol => protocol instanceof DhcpProtocol && protocol.enabled
            );

            const staticRouteEnabled = device.protocols.some(
                protocol => protocol instanceof StaticRouteProtocol && protocol.enabled
            );
            
            if (ripEnabled) {
                configurations.push(this.ripGenerator.generate(device));
            }

            if (ospfEnabled) {
                configurations.push(this.ospfGenerator.generate(device));
            }

            if (dhcpEnabled) {
                configurations.push(this.dhcpGenerator.generate(device));
            }

            if (staticRouteEnabled) {
                configurations.push(this.staticRouteGenerator.generate(device));
            }

            const content = [
                ...configurations,
                "end"
            ].join("\n");

            await this.store.saveGeneratedConfig(
                topologyId,
                `${device.hostname}.cfg`,
                content
            );

            console.log(
                `TopoCheck: Konfiguration gespeichert: ${device.hostname}.cfg`
            );

            generatedCount++;
        }

        return generatedCount;
    }
}
