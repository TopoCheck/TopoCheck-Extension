import * as assert from "assert";
import { ProtocolType } from "../../models/protocolType";
import type { Device } from "../../modules/topology/models";
import { isDeviceConfiguration, type DeviceConfiguration } from "../../shared/deviceConfiguration";
import { isProtocolComplete } from "../../shared/switchingSettings";
import { validateDeviceConfiguration } from "../../shared/validateDeviceConfiguration";

const device: Device = {
    id: "sw1", topologyId: "t", hostname: "SW1", label: "SW1", type: "switch",
    interfaces: [{ id: "fa1", deviceId: "sw1", name: "FastEthernet0/1", status: "up" }]
};

function configuration(patch: Partial<DeviceConfiguration> = {}): DeviceConfiguration {
    return {
        hostname: "SW1",
        interfaces: [{ id: "fa1", enabled: true, ipAddress: "", subnetMask: "", portMode: "auto", accessVlan: 10 }],
        protocols: [{ type: ProtocolType.Vlan, enabled: true, settings: { vlans: [{ id: 10, name: "Clients" }], nativeVlan: 99 } }],
        ...patch
    };
}

const codes = (data: DeviceConfiguration) => validateDeviceConfiguration(device, data).map((e) => e.code);

suite("H3b Switching-Eingaben", () => {
    test("vollständige VLAN-Konfiguration ist gültig", () => {
        assert.ok(isDeviceConfiguration(configuration()));
        assert.deepStrictEqual(codes(configuration()), []);
    });

    test("VLAN gilt erst mit mindestens einem benannten VLAN und Native VLAN als aktiviert", () => {
        assert.strictEqual(isProtocolComplete(ProtocolType.Vlan, { vlans: [], nativeVlan: 99 }), false);
        assert.strictEqual(isProtocolComplete(ProtocolType.Vlan, { vlans: [{ id: 10, name: "A" }] }), false);
        assert.strictEqual(isProtocolComplete(ProtocolType.Vlan, { vlans: [{ id: 10, name: "" }], nativeVlan: 99 }), false);
        assert.strictEqual(isProtocolComplete(ProtocolType.Vlan, { vlans: [{ id: 10, name: "A" }], nativeVlan: 99 }), true);
        assert.strictEqual(isProtocolComplete(ProtocolType.Dhcp, undefined), true);
    });

    test("reservierte, doppelte und falsch benannte VLANs werden abgelehnt", () => {
        const data = configuration({
            protocols: [{
                type: ProtocolType.Vlan, enabled: true, settings: {
                    vlans: [{ id: 1002, name: "x" }, { id: 10, name: "Clients" }, { id: 10, name: "Dup" }, { id: 20, name: "mit Leerzeichen" }],
                    nativeVlan: 999
                }
            }]
        });
        assert.deepStrictEqual(codes(data), ["vlan-id-invalid", "vlan-id-duplicate", "vlan-name-invalid", "native-vlan-invalid"]);
    });

    test("Access-VLAN muss auf dem Switch angelegt sein", () => {
        const data = configuration();
        data.interfaces[0].accessVlan = 30;
        assert.deepStrictEqual(codes(data), ["access-vlan-unknown"]);
    });

    test("STP und RSTP gleichzeitig sind nicht erlaubt", () => {
        const data = configuration();
        data.protocols.push({ type: ProtocolType.Stp, enabled: true, settings: { rootRole: "auto" } },
            { type: ProtocolType.Rstp, enabled: true, settings: { rootRole: "auto" } });
        assert.ok(codes(data).includes("stp-mode-conflict"));
    });

    test("ungültige Strukturen aus der Webview werden verworfen", () => {
        assert.strictEqual(isDeviceConfiguration(configuration({
            interfaces: [{
                id: "fa1", enabled: true, ipAddress: "", subnetMask: "",
                portMode: "hybrid" as never
            }]
        })), false);
        assert.strictEqual(isDeviceConfiguration(configuration({
            protocols: [{
                type: ProtocolType.Stp, enabled: true,
                settings: { rootRole: "boss" as never }
            }]
        })), false);
    });
});
