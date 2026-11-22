
import { IModule } from "../../core/interfaces/IModule";
import { TopologyStore } from "../topology/TopologyStore";
import { RipConfigGenerator } from "./RipConfigGenerator";
import { OspfConfigGenerator } from "./OspfConfigGenerator";
import { AclConfigGenerator } from "./AclConfigGenerator";
import { NatConfigGenerator } from "./NatConfigGenerator";
import {
    AclProtocol,
    NatProtocol,
    PatProtocol,
    RipProtocol,
    OspfProtocol
} from "../../models/ciscoProtocols";

export class ConfigModule implements IModule {
    name = "config";

    private readonly ripGenerator = new RipConfigGenerator();
    private readonly ospfGenerator = new OspfConfigGenerator();
    private readonly aclGenerator = new AclConfigGenerator();
    private readonly natGenerator = new NatConfigGenerator();

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

            const blocks: string[] = [
                `hostname ${device.hostname}`
            ];

            const ripEnabled = device.protocols.some(
                protocol => protocol instanceof RipProtocol && protocol.enabled
            );

            const ospfEnabled = device.protocols.some(
                protocol => protocol instanceof OspfProtocol && protocol.enabled
            );
            const acl = device.protocols.find(
                (protocol): protocol is AclProtocol =>
                    protocol instanceof AclProtocol && protocol.enabled && protocol.configurations.length > 0
            );

            const nat = device.protocols.find(
                (protocol): protocol is NatProtocol => protocol instanceof NatProtocol && protocol.enabled
            );
            const pat = device.protocols.find(
                (protocol): protocol is PatProtocol => protocol instanceof PatProtocol && protocol.enabled
            );
            const hasSecurityConfiguration = !!(acl || nat || pat);
            const routingExit = hasSecurityConfiguration ? "\n exit" : "";
            if (ripEnabled) {
                blocks.push(this.ripGenerator.generate(device) + routingExit);
            }

            if (ospfEnabled) {
                blocks.push(this.ospfGenerator.generate(device) + routingExit);
            }

            const interfaceCommands = new Map<string, string[]>();
            if (nat) {
                blocks.push(this.natGenerator.generate(device, nat, interfaceCommands).join("\n"));
            }
            if (acl) {
                blocks.push(...this.aclGenerator.generate(device, acl, interfaceCommands));
            }
            if (pat) {
                blocks.push(this.natGenerator.generatePat(device, pat, interfaceCommands));
            }
            for (const [name, commands] of interfaceCommands) {
                blocks.push([`interface ${name}`, ...commands, " exit"].join("\n"));
            }

            if (blocks.length === 1) {
                continue;
            }

            const content = [...blocks, "end"].join("\n\n");

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
