
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
            if (ripEnabled) {
                configurations.push(this.ripGenerator.generate(device));
                if (hasSecurityConfiguration) { configurations.push(" exit"); }
            }

            if (ospfEnabled) {
                configurations.push(this.ospfGenerator.generate(device));
                if (hasSecurityConfiguration) { configurations.push(" exit"); }
            }

            const interfaceCommands = new Map<string, string[]>();
            if (nat) {
                configurations.push(...this.natGenerator.generate(device, nat, interfaceCommands));
            }
            if (acl) {
                configurations.push(...this.aclGenerator.generate(device, acl, interfaceCommands));
            }
            if (pat) {
                configurations.push(this.natGenerator.generatePat(device, pat, interfaceCommands));
            }
            for (const [name, commands] of interfaceCommands) {
                configurations.push(`interface ${name}`, ...commands, " exit");
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
