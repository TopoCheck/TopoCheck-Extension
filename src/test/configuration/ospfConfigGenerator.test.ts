
import * as assert from "assert";
import { suite, test } from "mocha";

import { DeviceType } from "../../models/deviceType";
import { OspfProtocol } from "../../models/ciscoProtocols";
import { NetworkDevice } from "../../models/networkDevice";
import { OspfConfigGenerator } from "../../modules/config/OspfConfigGenerator";
import { NetworkInterface } from "../../models/networkInterface";
import { InterfaceType } from "../../models/interfaceType";

suite("OspfConfigGenerator", () => {
    test("generates OSPF configuration for a router", () => {
        const router = new NetworkDevice({
            id: "router-1",
            hostname: "R1",
            type: DeviceType.Router
        });

        const ospf = new OspfProtocol("ospf-1");
        ospf.enable();

        ospf.processes.push({
            processId: 1,
            routerId: "1.1.1.1",
            networks: [
                {
                    address: "192.168.1.0",
                    wildcardMask: "0.0.0.255",
                    area: "0"
                }
            ],
            passiveInterfaceDefault: false,
            passiveInterfaces: {}
        });

        router.addProtocol(ospf);

        const generator = new OspfConfigGenerator();
        const result = generator.generate(router);

        assert.strictEqual(
            result,
            [
                "router ospf 1",
                " router-id 1.1.1.1",
                " network 192.168.1.0 0.0.0.255 area 0"
            ].join("\n")
        );
    });

    test("generates multiple OSPF network statements", () => {
        const router = new NetworkDevice({
            id: "router-2",
            hostname: "R2",
            type: DeviceType.Router
        });

        const ospf = new OspfProtocol("ospf-2");
        ospf.enable();

        ospf.processes.push({
            processId: 1,
            networks: [
                {
                    address: "192.168.1.0",
                    wildcardMask: "0.0.0.255",
                    area: "0"
                },
                {
                    address: "10.0.0.0",
                    wildcardMask: "0.0.0.255",
                    area: "1"
                }
            ],
            passiveInterfaceDefault: false,
            passiveInterfaces: {}
        });

        router.addProtocol(ospf);

        const result = new OspfConfigGenerator().generate(router);

        assert.ok(result.includes("network 192.168.1.0 0.0.0.255 area 0"));
        assert.ok(result.includes("network 10.0.0.0 0.0.0.255 area 1"));
    });

    test("generates passive-interface commands", () => {
        const router = new NetworkDevice({
            id: "router-3",
            hostname: "R3",
            type: DeviceType.Router
        });

        const ospf = new OspfProtocol("ospf-3");
        ospf.enable();

        ospf.processes.push({
            processId: 1,
            networks: [
                {
                    address: "192.168.1.0",
                    wildcardMask: "0.0.0.255",
                    area: "0"
                }
            ],
            passiveInterfaceDefault: true,
            passiveInterfaces: {
                "GigabitEthernet0/0": false
            }
        });

        router.addProtocol(ospf);

        const result = new OspfConfigGenerator().generate(router);

        assert.ok(result.includes("passive-interface default"));
        assert.ok(result.includes("no passive-interface GigabitEthernet0/0"));
    });

    test("throws an error when OSPF is not configured", () => {
        const router = new NetworkDevice({
            id: "router-4",
            hostname: "R4",
            type: DeviceType.Router
        });

        const generator = new OspfConfigGenerator();

        assert.throws(
            () => generator.generate(router),
            /OSPF is not enabled/
        );
    });

    test("throws an error when the device is a switch", () => {
        const switchDevice = new NetworkDevice({
            id: "switch-1",
            hostname: "SW1",
            type: DeviceType.Switch
        });

        const generator = new OspfConfigGenerator();

        assert.throws(
            () => generator.generate(switchDevice),
            /only be generated for routers/
        );
    });

    test("throws an error when no OSPF process exists", () => {
        const router = new NetworkDevice({
            id: "router-5",
            hostname: "R5",
            type: DeviceType.Router
        });

        const ospf = new OspfProtocol("ospf-5");
        ospf.enable();
        router.addProtocol(ospf);

        const generator = new OspfConfigGenerator();

        assert.throws(
            () => generator.generate(router),
            /No OSPF processes configured/
        );
    });


    test("automatically detects networks from Layer 3 interfaces", () => {
        const router = new NetworkDevice({
            id: "router-auto-1",
            hostname: "R-AUTO1",
            type: DeviceType.Router
        });

        router.addInterface(new NetworkInterface({
            id: "interface-1",
            name: "GigabitEthernet0/0",
            type: InterfaceType.GigabitEthernet,
            layer: 3,
            ipAddress: "192.168.1.10",
            subnetMask: "255.255.255.0"
        }));

        const ospf = new OspfProtocol("ospf-auto-1");
        ospf.enable();
        ospf.processes.push({
            processId: 1,
            networks: [],
            passiveInterfaceDefault: false,
            passiveInterfaces: {}
        });

        router.addProtocol(ospf);

        const result = new OspfConfigGenerator().generate(router);

        assert.ok(
            result.includes("network 192.168.1.0 0.0.0.255 area 0")
        );
    });

    test("ignores disabled interfaces during automatic detection", () => {
        const router = new NetworkDevice({
            id: "router-auto-2",
            hostname: "R-AUTO2",
            type: DeviceType.Router
        });

        router.addInterface(new NetworkInterface({
            id: "interface-2",
            name: "GigabitEthernet0/0",
            type: InterfaceType.GigabitEthernet,
            layer: 3,
            enabled: false,
            ipAddress: "192.168.1.10",
            subnetMask: "255.255.255.0"
        }));

        const ospf = new OspfProtocol("ospf-auto-2");
        ospf.enable();
        ospf.processes.push({
            processId: 1,
            networks: [],
            passiveInterfaceDefault: false,
            passiveInterfaces: {}
        });

        router.addProtocol(ospf);

        assert.throws(
            () => new OspfConfigGenerator().generate(router),
            /has no networks/
        );
    });

    test("ignores Layer 2 interfaces during automatic detection", () => {
        const router = new NetworkDevice({
            id: "router-auto-3",
            hostname: "R-AUTO3",
            type: DeviceType.Router
        });

        router.addInterface(new NetworkInterface({
            id: "interface-3",
            name: "GigabitEthernet0/0",
            type: InterfaceType.GigabitEthernet,
            layer: 2,
            ipAddress: "192.168.1.10",
            subnetMask: "255.255.255.0"
        }));

        const ospf = new OspfProtocol("ospf-auto-3");
        ospf.enable();
        ospf.processes.push({
            processId: 1,
            networks: [],
            passiveInterfaceDefault: false,
            passiveInterfaces: {}
        });

        router.addProtocol(ospf);

        assert.throws(
            () => new OspfConfigGenerator().generate(router),
            /has no networks/
        );
    });

    test("combines automatically detected and manually configured networks", () => {
        const router = new NetworkDevice({
            id: "router-auto-4",
            hostname: "R-AUTO4",
            type: DeviceType.Router
        });

        router.addInterface(new NetworkInterface({
            id: "interface-4",
            name: "GigabitEthernet0/0",
            type: InterfaceType.GigabitEthernet,
            layer: 3,
            ipAddress: "192.168.1.10",
            subnetMask: "255.255.255.0"
        }));

        const ospf = new OspfProtocol("ospf-auto-4");
        ospf.enable();
        ospf.processes.push({
            processId: 1,
            networks: [{
                address: "10.0.0.0",
                wildcardMask: "0.0.0.255",
                area: "1"
            }],
            passiveInterfaceDefault: false,
            passiveInterfaces: {}
        });

        router.addProtocol(ospf);

        const result = new OspfConfigGenerator().generate(router);

        assert.ok(
            result.includes("network 192.168.1.0 0.0.0.255 area 0")
        );
        assert.ok(
            result.includes("network 10.0.0.0 0.0.0.255 area 1")
        );
    });
});
