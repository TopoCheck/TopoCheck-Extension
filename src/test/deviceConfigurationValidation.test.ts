import * as assert from "assert";
import { InterfaceType } from "../models/interfaceType";
import { NetworkInterface } from "../models/networkInterface";
import { ProtocolType } from "../models/protocolType";
import type { Device } from "../modules/topology/models";
import { buildConfiguredDevice, configurationOf } from "../shared/deviceConfiguration";
import { DeviceConfigurationValidationError, validateDeviceConfiguration } from "../shared/validateDeviceConfiguration";

suite("H2c field validation (without VS Code or DOM)", () => {
    const device: Device = {
        id: "router", topologyId: "test", hostname: "R1", label: "R1", type: "router",
        interfaces: [
            { id: "gi0", deviceId: "router", name: "GigabitEthernet0/0", status: "up" },
            { id: "gi1", deviceId: "router", name: "GigabitEthernet0/1", status: "down" }
        ]
    };

    test("Accepts valid values and never mutates the draft or device", () => {
        const draft = configurationOf(device);
        draft.hostname = " R2 ";
        Object.assign(draft.interfaces[0], { ipAddress: " 192.168.1.10 ", subnetMask: " 255.255.255.0 " });
        draft.protocols = [{ type: ProtocolType.Ospf, enabled: true }];
        const before = JSON.stringify({ device, draft });
        assert.deepStrictEqual(validateDeviceConfiguration(device, draft, ["R3"]), []);
        assert.strictEqual(JSON.stringify({ device, draft }), before);
    });

    test("Reports invalid, empty, long and duplicate hostnames on the hostname field", () => {
        for (const hostname of ["", " ", "1Router", "Router-", "R".repeat(64)]) {
            const errors = validateDeviceConfiguration(device, { ...configurationOf(device), hostname });
            assert.strictEqual(errors[0].field, "hostname");
            assert.strictEqual(errors[0].code, "hostname-invalid");
            assert.ok(!errors[0].message.includes("${"));
        }
        const errors = validateDeviceConfiguration(device, { ...configurationOf(device), hostname: "r2" }, ["R2"]);
        assert.strictEqual(errors[0].code, "hostname-taken");
    });

    test("Collects simultaneous hostname, IP and mask errors with precise field paths", () => {
        const draft = configurationOf(device);
        draft.hostname = "";
        Object.assign(draft.interfaces[0], { ipAddress: "999.1.1.1", subnetMask: "255.0.255.0" });
        draft.interfaces[1].ipAddress = "10.0.0.1";
        const errors = validateDeviceConfiguration(device, draft);
        assert.deepStrictEqual(errors.map((error) => error.field), [
            "hostname", "interfaces.0.ipAddress", "interfaces.0.subnetMask", "interfaces.1.subnetMask"
        ]);
        assert.ok(errors.every((error) => error.message.length > 0 && error.code.length > 0));
    });

    test("IP and mask may both be empty; a missing partner is assigned to its own field", () => {
        const draft = configurationOf(device);
        assert.deepStrictEqual(validateDeviceConfiguration(device, draft), []);
        draft.interfaces[0].ipAddress = "10.0.0.1";
        assert.strictEqual(validateDeviceConfiguration(device, draft)[0].field, "interfaces.0.subnetMask");
        draft.interfaces[0].ipAddress = "";
        draft.interfaces[0].subnetMask = "255.255.255.0";
        assert.strictEqual(validateDeviceConfiguration(device, draft)[0].field, "interfaces.0.ipAddress");
    });

    test("Rejects malformed IPv4 values even on disabled interfaces", () => {
        for (const ipAddress of ["256.0.0.1", "-1.0.0.1", "1.2.3", "1.2.3.4.5", "abc", "1.2.3.1e2"]) {
            const draft = configurationOf(device);
            Object.assign(draft.interfaces[0], { enabled: false, ipAddress, subnetMask: "255.255.255.0" });
            assert.strictEqual(validateDeviceConfiguration(device, draft)[0].code, "ip-address-invalid");
        }
    });

    test("Checks mask contiguity across octets and permits /0, /31 and /32", () => {
        for (const subnetMask of ["0.0.0.0", "128.0.0.0", "255.255.254.0", "255.255.255.254", "255.255.255.255"]) {
            const draft = configurationOf(device);
            Object.assign(draft.interfaces[0], { ipAddress: "10.0.0.1", subnetMask });
            assert.deepStrictEqual(validateDeviceConfiguration(device, draft), []);
        }
        for (const subnetMask of ["255.0.255.0", "255.254.128.0", "255.255.255.1", "256.0.0.0"]) {
            const draft = configurationOf(device);
            Object.assign(draft.interfaces[0], { ipAddress: "10.0.0.1", subnetMask });
            assert.strictEqual(validateDeviceConfiguration(device, draft)[0].code, "subnet-mask-invalid");
        }
    });

    test("Uses H1c protocol compatibility and reports duplicates by field", () => {
        const draft = configurationOf(device);
        draft.protocols = [{ type: ProtocolType.Vlan, enabled: false }];
        assert.strictEqual(validateDeviceConfiguration(device, draft)[0].field, "protocols.0.type");
        assert.strictEqual(validateDeviceConfiguration(device, draft)[0].code, "protocol-incompatible");
        assert.deepStrictEqual(validateDeviceConfiguration({ ...device, type: "switch" }, draft), []);
        assert.strictEqual(validateDeviceConfiguration({ ...device, type: "pc" }, draft)[0].code, "protocol-incompatible");
        draft.protocols = [{ type: ProtocolType.Ospf, enabled: true }, { type: ProtocolType.Ospf, enabled: false }];
        assert.strictEqual(validateDeviceConfiguration(device, draft)[0].field, "protocols.1.type");
        assert.strictEqual(validateDeviceConfiguration(device, draft)[0].code, "protocol-duplicate");
    });

    test("Reports a removed device as deviceId instead of throwing", () => {
        assert.deepStrictEqual(validateDeviceConfiguration(undefined, configurationOf(device)).map(({ field, code }) => ({ field, code })),
            [{ field: "deviceId", code: "device-not-found" }]);
    });

    test("Rejects missing, duplicate, unknown and foreign interfaces", () => {
        const draft = configurationOf(device);
        draft.interfaces[0].id = "unknown";
        assert.ok(validateDeviceConfiguration(device, draft).some((error) => error.code === "interface-not-found"));
        draft.interfaces[0].id = "gi1";
        assert.ok(validateDeviceConfiguration(device, draft).some((error) => error.code === "interface-duplicate"));
        draft.interfaces = [];
        assert.strictEqual(validateDeviceConfiguration(device, draft)[0].code, "interfaces-incomplete");
        const foreign = { ...device, interfaces: device.interfaces.map((iface) => ({ ...iface, deviceId: "another-router" })) };
        assert.strictEqual(validateDeviceConfiguration(foreign, configurationOf(device))[0].code, "interface-not-found");
        const duplicateNames = { ...device, interfaces: device.interfaces.map((iface) => ({ ...iface, name: " Gi0/0 " })) };
        duplicateNames.interfaces[1].name = "Gi0/0";
        assert.ok(validateDeviceConfiguration(duplicateNames, configurationOf(duplicateNames))
            .some((error) => error.code === "interface-name-invalid"));
    });

    test("The H1c model itself rejects non-contiguous masks without changing its old values", () => {
        const iface = new NetworkInterface({ id: "gi0", name: "Gi0/0", type: InterfaceType.GigabitEthernet,
            ipAddress: "10.0.0.1", subnetMask: "255.255.255.0" });
        assert.throws(() => iface.setIpConfiguration("10.0.0.2", "255.0.255.0"), /Invalid subnet mask/);
        assert.strictEqual(iface.ipAddress, "10.0.0.1");
        assert.strictEqual(iface.subnetMask, "255.255.255.0");
    });

    test("Model building exposes the same field errors as standalone validation", () => {
        const draft = configurationOf(device);
        draft.hostname = "";
        draft.interfaces[0].ipAddress = "999.1.1.1";
        const errors = validateDeviceConfiguration(device, draft);
        assert.throws(() => buildConfiguredDevice(device, draft, []), (error: unknown) =>
            error instanceof DeviceConfigurationValidationError &&
            JSON.stringify(error.errors) === JSON.stringify(errors));
    });
});
