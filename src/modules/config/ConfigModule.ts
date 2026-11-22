
import { IModule } from "../../core/interfaces/IModule";
import { TopologyStore } from "../topology/TopologyStore";
import { RipConfigGenerator } from "./RipConfigGenerator";
import { OspfConfigGenerator } from "./OspfConfigGenerator";
import { AclConfigGenerator } from "./AclConfigGenerator";
import {
    AclProtocol,
    RipProtocol,
    OspfProtocol
} from "../../models/ciscoProtocols";

export class ConfigModule implements IModule {
    name = "config";

    private readonly ripGenerator = new RipConfigGenerator();
    private readonly ospfGenerator = new OspfConfigGenerator();
    private readonly aclGenerator = new AclConfigGenerator();

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
                `hostname ${device.hostname}`
            ];

            const ripEnabled = device.protocols.some(
                protocol => protocol instanceof RipProtocol && protocol.enabled
            );

            const ospfEnabled = device.protocols.some(
                protocol => protocol instanceof OspfProtocol && protocol.enabled
            );
            const acl = device.protocols.find(
                (protocol): protocol is AclProtocol => protocol instanceof AclProtocol && protocol.enabled
            );

            if (ripEnabled) {
                configurations.push(this.ripGenerator.generate(device));
            }

            if (ospfEnabled) {
                configurations.push(this.ospfGenerator.generate(device));
            }

            if (acl) {
                if (ripEnabled || ospfEnabled) {
                    configurations.push(" exit");
                }
                configurations.push(this.aclGenerator.generate(device, acl));
            }

            if (configurations.length === 1) {
                continue;
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
