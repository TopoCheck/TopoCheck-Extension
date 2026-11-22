import { NetworkDevice } from "../../models/networkDevice";
import { formatIosSection, joinIosBlocks } from "../../generator/iosSections";
import { DeviceType } from "../../models/deviceType";

export class BasicConfigGenerator {
    public generate(
        device: NetworkDevice,
        protocolBlocks: readonly string[] = [],
        interfaceCommands?: ReadonlyMap<string, string[]>
    ): string {
        if (device.type !== DeviceType.Router) {
            throw new Error(
                "Basic configuration is only supported for routers."
            );
        }

        const configuration: string[] = [
            `hostname ${device.hostname}`,
            "no ip domain-lookup"
        ];

        if (device.domainName) {
            configuration.push(`ip domain-name ${device.domainName}`);
        }

        if (device.enableSecret) {
            configuration.push(`enable secret ${device.enableSecret}`);
        }

        if (device.banner) {
            const banner = device.banner
                .replace(/[\r\n]+/g, " ")
                .replace(/\^C/g, "");

            configuration.push(`banner motd #${banner}#`);
        }

        const interfaces: string[] = [];
        for (const networkInterface of device.interfaces) {
            const lines = [`interface ${networkInterface.name}`];

            if (networkInterface.description) {
                const description = networkInterface.description
                    .replace(/[\r\n]+/g, " ")
                    .trim();

                if (description.length > 0) {
                    lines.push(` description ${description}`);
                }
            }

            if (
                networkInterface.layer !== 2 &&
                networkInterface.ipAddress &&
                networkInterface.subnetMask
            ) {
                lines.push(
                    ` ip address ${networkInterface.ipAddress} ${networkInterface.subnetMask}`
                );
            }

            lines.push(
                networkInterface.enabled ? " no shutdown" : " shutdown"
            );

            lines.push(...(interfaceCommands?.get(networkInterface.name) ?? []));
            lines.push(" exit");
            interfaces.push(lines.join("\n"));
        }

        const access: string[] = [];
        if (device.consolePassword) {
            access.push([
                "line console 0",
                ` password ${device.consolePassword}`,
                " login",
                " exit"
            ].join("\n"));
        }

        if (device.vtyPassword) {
            access.push([
                "line vty 0 4",
                ` password ${device.vtyPassword}`,
                " login",
                " exit"
            ].join("\n"));
        }

        return joinIosBlocks([
            formatIosSection("Grundkonfiguration", [configuration.join("\n")]),
            formatIosSection("Konsolen- und VTY-Zugang", access),
            ...protocolBlocks,
            formatIosSection("Interfaces", interfaces)
        ]);
    }
}
