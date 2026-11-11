
import * as assert from "assert";
import { suite, test } from "mocha";

import { DeviceType } from "../../models/deviceType";
import { InterfaceType } from "../../models/interfaceType";
import { NetworkDevice } from "../../models/networkDevice";
import { NetworkInterface } from "../../models/networkInterface";
import { RipProtocol } from "../../models/ciscoProtocols";
import { RipConfigGenerator } from "../../modules/config/RipConfigGenerator";

suite("RipConfigGenerator", () => {
    test("generates RIP v2 configuration for a router", () => {
        const router = new NetworkDevice({
            id: "router-1",
            hostname: "R1",
            type: DeviceType.Router
        });

        router.addInterface(new NetworkInterface({
            id: "interface-1",
            name: "GigabitEthernet0/0",
            type: InterfaceType.Ethernet,
            enabled: true,
            ipAddress: "192.168.1.1",
            subnetMask: "255.255.255.0",
            layer: 3
        }));

        const rip = new RipProtocol("rip-1");
        rip.enable();
        router.addProtocol(rip);

        const generator = new RipConfigGenerator();
        const result = generator.generate(router);

        assert.strictEqual(
            result,
            [
                "router rip",
                " version 2",
                " no auto-summary",
                " network 192.168.1.0"
            ].join("\n")
        );
    });

    test("does not generate duplicate network statements", () => {
        const router = new NetworkDevice({
            id: "router-2",
            hostname: "R2",
            type: DeviceType.Router
        });

        for (let index = 1; index <= 2; index++) {
            router.addInterface(new NetworkInterface({
                id: `interface-${index}`,
                name: `GigabitEthernet0/${index}`,
                type: InterfaceType.Ethernet,
                enabled: true,
                ipAddress: `192.168.1.${index}`,
                subnetMask: "255.255.255.0",
                layer: 3
            }));
        }

        const rip = new RipProtocol("rip-2");
        rip.enable();
        router.addProtocol(rip);

        const generator = new RipConfigGenerator();
        const result = generator.generate(router);

        const occurrences = result.match(/network 192\.168\.1\.0/g);

        assert.strictEqual(occurrences?.length, 1);
    });

    test("ignores disabled interfaces", () => {
        const router = new NetworkDevice({
            id: "router-3",
            hostname: "R3",
            type: DeviceType.Router
        });

        router.addInterface(new NetworkInterface({
            id: "interface-1",
            name: "GigabitEthernet0/0",
            type: InterfaceType.Ethernet,
            enabled: false,
            ipAddress: "192.168.1.1",
            subnetMask: "255.255.255.0",
            layer: 3
        }));

        const rip = new RipProtocol("rip-3");
        rip.enable();
        router.addProtocol(rip);

        const generator = new RipConfigGenerator();

        assert.throws(
            () => generator.generate(router),
            /No valid networks found/
        );
    });


    test("throws an error when RIP is not configured", () => {
        const router = new NetworkDevice({
            id: "router-4",
            hostname: "R4",
            type: DeviceType.Router
        });

        const generator = new RipConfigGenerator();

        assert.throws(
            () => generator.generate(router),
            /RIP is not enabled/
        );
    });

    test("throws an error when the device is a switch", () => {
        const switchDevice = new NetworkDevice({
            id: "switch-1",
            hostname: "SW1",
            type: DeviceType.Switch
        });

        const generator = new RipConfigGenerator();

        assert.throws(
            () => generator.generate(switchDevice),
            /only be generated for routers/
        );
    });

    test("generates multiple different network statements", () => {
        const router = new NetworkDevice({
            id: "router-5",
            hostname: "R5",
            type: DeviceType.Router
        });

        router.addInterface(new NetworkInterface({
            id: "interface-1",
            name: "GigabitEthernet0/0",
            type: InterfaceType.Ethernet,
            enabled: true,
            ipAddress: "192.168.1.1",
            subnetMask: "255.255.255.0",
            layer: 3
        }));

        router.addInterface(new NetworkInterface({
            id: "interface-2",
            name: "GigabitEthernet0/1",
            type: InterfaceType.Ethernet,
            enabled: true,
            ipAddress: "10.0.0.1",
            subnetMask: "255.255.255.0",
            layer: 3
        }));

        const rip = new RipProtocol("rip-5");
        rip.enable();
        router.addProtocol(rip);

        const generator = new RipConfigGenerator();
        const result = generator.generate(router);

        assert.ok(result.includes("network 192.168.1.0"));
        assert.ok(result.includes("network 10.0.0.0"));
    });

    test("includes manually configured RIP networks", () => {
        const router = new NetworkDevice({
            id: "router-6",
            hostname: "R6",
            type: DeviceType.Router
        });

        const rip = new RipProtocol("rip-6");
        rip.enable();
        rip.networks.push({ address: "172.16.0.0" });
        router.addProtocol(rip);

        const generator = new RipConfigGenerator();
        const result = generator.generate(router);

        assert.ok(result.includes("network 172.16.0.0"));
    });

});
