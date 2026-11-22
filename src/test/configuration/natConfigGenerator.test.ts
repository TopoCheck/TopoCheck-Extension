import * as assert from "assert";
import { randomUUID } from "crypto";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { PatConfiguration, StaticNatConfiguration } from "../../models/ciscoProtocols";
import { ProtocolType } from "../../models/protocolType";
import { ConfigModule } from "../../modules/config/ConfigModule";
import type { Device } from "../../modules/topology/models";
import { TopologyStore } from "../../modules/topology/TopologyStore";
import { configurationOf } from "../../shared/deviceConfiguration";
import { DeviceConfigurationValidationError } from "../../shared/validateDeviceConfiguration";

suite("NAT and PAT configuration generation", () => {
    let storage: vscode.Uri;
    let store: TopologyStore;
    let topologyId: string;
    let router: Device;
    let nat: StaticNatConfiguration;

    setup(async () => {
        storage = vscode.Uri.file(path.join(os.tmpdir(), `topocheck-nat-${randomUUID()}`));
        store = new TopologyStore(storage);
        topologyId = (await store.createTopology("NAT test")).id;
        router = await store.addDevice(topologyId, { type: "router" });
        nat = {
            insideInterfaceId: router.interfaces[0].id,
            outsideInterfaceId: router.interfaces[1].id,
            mappings: [
                { localAddress: "192.168.1.5", globalAddress: "203.0.113.5" },
                { localAddress: "192.168.1.6", globalAddress: "203.0.113.6" }
            ]
        };
    });

    teardown(async () => {
        store.dispose();
        await vscode.workspace.fs.delete(storage, { recursive: true, useTrash: false });
    });

    async function readConfig(): Promise<string> {
        const file = vscode.Uri.joinPath(storage, "NAT test", "Generated Configs", `${router.hostname}.cfg`);
        return Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8");
    }

    test("persists mappings and generates both roles on a NAT-only router", async () => {
        const draft = configurationOf(router);
        draft.protocols = [{ type: ProtocolType.Nat, enabled: true, nat }];
        await store.configureDevice(topologyId, router.id, draft);
        const [savedRouter] = (await store.loadTopology(topologyId)).devices;
        assert.deepStrictEqual(configurationOf(savedRouter).protocols, draft.protocols);

        const generator = new ConfigModule(store);
        assert.strictEqual(await generator.generateForTopology(topologyId), 1);
        assert.strictEqual(await readConfig(), [
            `hostname ${router.hostname}`, "",
            "ip nat inside source static 192.168.1.5 203.0.113.5",
            "ip nat inside source static 192.168.1.6 203.0.113.6", "",
            `interface ${router.interfaces[0].name}`, " ip nat inside", " exit", "",
            `interface ${router.interfaces[1].name}`, " ip nat outside", " exit", "", "end"
        ].join("\n"));

        draft.protocols[0].enabled = false;
        await store.configureDevice(topologyId, router.id, draft);
        assert.strictEqual(await generator.generateForTopology(topologyId), 0);
    });

    test("writes the NAT role and ACL binding in one interface block", async () => {
        const draft = configurationOf(router);
        draft.protocols = [
            { type: ProtocolType.Nat, enabled: true, nat },
            {
                type: ProtocolType.Acl, enabled: true, acls: [{
                    name: "INSIDE_FILTER",
                    rules: [{ action: "permit", source: "any", sourceWildcard: "", destination: "any", destinationWildcard: "" }],
                    binding: { interfaceId: nat.insideInterfaceId, direction: "in" }
                }]
            }
        ];
        await store.configureDevice(topologyId, router.id, draft);
        assert.strictEqual(await new ConfigModule(store).generateForTopology(topologyId), 1);
        const lines = (await readConfig()).split("\n");
        const interfaceLine = `interface ${router.interfaces[0].name}`;
        assert.strictEqual(lines.filter((line) => line === interfaceLine).length, 1);
        const start = lines.indexOf(interfaceLine);
        assert.deepStrictEqual(lines.slice(start, start + 4),
            [interfaceLine, " ip nat inside", " ip access-group INSIDE_FILTER in", " exit"]);
        assert.ok(lines.indexOf("ip access-list extended INSIDE_FILTER") < start);
    });

    test("rejects conflicting interface roles and invalid or duplicate addresses", async () => {
        nat.outsideInterfaceId = nat.insideInterfaceId;
        nat.mappings[1].localAddress = nat.mappings[0].localAddress;
        nat.mappings[1].globalAddress = "224.0.0.1";
        const draft = configurationOf(router);
        draft.protocols = [{ type: ProtocolType.Nat, enabled: true, nat }];
        await assert.rejects(store.configureDevice(topologyId, router.id, draft),
            (error: unknown) => error instanceof DeviceConfigurationValidationError &&
                error.errors.some(({ code }) => code === "nat-interface-duplicate") &&
                error.errors.some(({ code }) => code === "nat-address-invalid") &&
                error.errors.some(({ code }) => code === "nat-address-duplicate"));
    });

    function patDraft() {
        const pat: PatConfiguration = {
            insideInterfaceId: nat.insideInterfaceId,
            outsideInterfaceId: nat.outsideInterfaceId,
            aclName: "PAT_SOURCES"
        };
        const draft = configurationOf(router);
        draft.protocols = [
            { type: ProtocolType.Pat, enabled: true, pat },
            {
                type: ProtocolType.Acl, enabled: true, acls: [{
                    name: pat.aclName,
                    rules: [{ action: "permit", source: "192.168.1.0", sourceWildcard: "0.0.0.255", destination: "any", destinationWildcard: "" }]
                }]
            }
        ];
        return { draft, pat };
    }

    test("persists PAT and generates overload without static NAT or routing", async () => {
        const { draft } = patDraft();
        await store.configureDevice(topologyId, router.id, draft);
        const [savedRouter] = (await store.loadTopology(topologyId)).devices;
        assert.deepStrictEqual(configurationOf(savedRouter).protocols, draft.protocols);

        assert.strictEqual(await new ConfigModule(store).generateForTopology(topologyId), 1);
        assert.strictEqual(await readConfig(), [
            `hostname ${router.hostname}`, "",
            "ip access-list extended PAT_SOURCES", " permit ip 192.168.1.0 0.0.0.255 any", " exit", "",
            `ip nat inside source list PAT_SOURCES interface ${router.interfaces[1].name} overload`, "",
            `interface ${router.interfaces[0].name}`, " ip nat inside", " exit", "",
            `interface ${router.interfaces[1].name}`, " ip nat outside", " exit", "", "end"
        ].join("\n"));
    });

    test("generates OSPF, static NAT and PAT together without repeating interface roles", async () => {
        const { draft, pat } = patDraft();
        draft.protocols.push(
            { type: ProtocolType.Nat, enabled: true, nat },
            { type: ProtocolType.Ospf, enabled: true, ospf: { processes: [{
                processId: 1,
                networks: [{ address: "192.168.1.0", wildcardMask: "0.0.0.255", area: "0" }],
                passiveInterfaceDefault: false, passiveInterfaces: {}
            }, {
                processId: 2,
                networks: [{ address: "192.168.2.0", wildcardMask: "0.0.0.255", area: "0" }],
                passiveInterfaceDefault: false, passiveInterfaces: {}
            }] } }
        );
        await store.configureDevice(topologyId, router.id, draft);
        const generator = new ConfigModule(store);
        assert.strictEqual(await generator.generateForTopology(topologyId), 1);
        const config = await readConfig();
        assert.ok(config.includes("router ospf 1\n network 192.168.1.0 0.0.0.255 area 0\n\nrouter ospf 2"));
        assert.ok(config.includes(" network 192.168.2.0 0.0.0.255 area 0\n exit\n\nip nat inside source static"));
        assert.ok(config.includes("ip nat inside source static 192.168.1.5 203.0.113.5"));
        const overload = `ip nat inside source list ${pat.aclName} interface ${router.interfaces[1].name} overload`;
        assert.ok(config.includes(overload));
        assert.strictEqual(config.split("\n").filter((line) => line === " ip nat inside").length, 1);
        assert.strictEqual(config.split("\n").filter((line) => line === " ip nat outside").length, 1);
    });

    test("rejects unavailable ACLs and interfaces assigned opposite static NAT roles", async () => {
        const { draft, pat } = patDraft();
        draft.protocols[1].enabled = false;
        draft.protocols.push({ type: ProtocolType.Nat, enabled: true, nat });
        pat.insideInterfaceId = nat.outsideInterfaceId;
        pat.outsideInterfaceId = nat.insideInterfaceId;

        await assert.rejects(store.configureDevice(topologyId, router.id, draft),
            (error: unknown) => error instanceof DeviceConfigurationValidationError &&
                error.errors.some(({ code }) => code === "pat-acl-invalid") &&
                error.errors.filter(({ code }) => code === "nat-role-conflict").length === 2);
    });
});
