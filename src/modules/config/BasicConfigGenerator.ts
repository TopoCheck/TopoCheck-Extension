import { NetworkDevice } from "../../models/networkDevice";
import { DeviceType } from "../../models/deviceType";

export class BasicConfigGenerator {
    public generate(device: NetworkDevice): string {
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

        for (const networkInterface of device.interfaces) {
            configuration.push("");
            configuration.push(`interface ${networkInterface.name}`);

            if (networkInterface.description) {
                const description = networkInterface.description
                    .replace(/[\r\n]+/g, " ")
                    .trim();

                if (description.length > 0) {
                    configuration.push(` description ${description}`);
                }
            }

            if (
                networkInterface.layer !== 2 &&
                networkInterface.ipAddress &&
                networkInterface.subnetMask
            ) {
                configuration.push(
                    ` ip address ${networkInterface.ipAddress} ${networkInterface.subnetMask}`
                );
            }

            configuration.push(
                networkInterface.enabled ? " no shutdown" : " shutdown"
            );

            configuration.push(" exit");
        }

        if (device.consolePassword) {
            configuration.push(
                "",
                "line console 0",
                ` password ${device.consolePassword}`,
                " login",
                " exit"
            );
        }

        if (device.vtyPassword) {
            configuration.push(
                "",
                "line vty 0 4",
                ` password ${device.vtyPassword}`,
                " login",
                " exit"
            );
        }

        return configuration.join("\n");
    }
}