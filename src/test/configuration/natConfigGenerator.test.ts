import * as assert from "assert";
import { randomUUID } from "crypto";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { StaticNatConfiguration } from "../../models/ciscoProtocols";
import { ProtocolType } from "../../models/protocolType";
import { ConfigModule } from "../../modules/config/ConfigModule";
import type { Device } from "../../modules/topology/models";
import { TopologyStore } from "../../modules/topology/TopologyStore";
import { configurationOf } from "../../shared/deviceConfiguration";
import { DeviceConfigurationValidationError } from "../../shared/validateDeviceConfiguration";

suite("Static NAT configuration generation", () => {
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
            `hostname ${router.hostname}`,
            "ip nat inside source static 192.168.1.5 203.0.113.5",
            "ip nat inside source static 192.168.1.6 203.0.113.6",
            `interface ${router.interfaces[0].name}`, " ip nat inside", " exit",
            `interface ${router.interfaces[1].name}`, " ip nat outside", " exit", "end"
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
});
