import * as assert from "assert";
import { randomUUID } from "crypto";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { Ipv4AclConfiguration } from "../../models/ciscoProtocols";
import { ProtocolType } from "../../models/protocolType";
import { ConfigModule } from "../../modules/config/ConfigModule";
import type { Device } from "../../modules/topology/models";
import { TopologyStore } from "../../modules/topology/TopologyStore";
import { configurationOf } from "../../shared/deviceConfiguration";
import { DeviceConfigurationValidationError } from "../../shared/validateDeviceConfiguration";

suite("IPv4 ACL configuration generation", () => {
    let storage: vscode.Uri;
    let store: TopologyStore;
    let topologyId: string;
    let router: Device;
    let acl: Ipv4AclConfiguration;

    setup(async () => {
        storage = vscode.Uri.file(path.join(os.tmpdir(), `topocheck-acl-${randomUUID()}`));
        store = new TopologyStore(storage);
        topologyId = (await store.createTopology("ACL test")).id;
        router = await store.addDevice(topologyId, { type: "router" });
        acl = {
            name: "LAB_FILTER",
            rules: [
                { action: "deny", source: "192.0.2.4", sourceWildcard: "", destination: "any", destinationWildcard: "" },
                { action: "permit", source: "192.0.2.0", sourceWildcard: "0.0.0.255", destination: "any", destinationWildcard: "" },
                { action: "deny", source: "any", sourceWildcard: "", destination: "198.51.100.1", destinationWildcard: "" }
            ],
            binding: { interfaceId: router.interfaces[0].id, direction: "in" }
        };
    });

    teardown(async () => {
        store.dispose();
        await vscode.workspace.fs.delete(storage, { recursive: true, useTrash: false });
    });

    async function readConfig(): Promise<string> {
        const file = vscode.Uri.joinPath(storage, "ACL test", "Generated Configs", `${router.hostname}.cfg`);
        return Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8");
    }

    test("persists ACL rules and generates a router config without RIP or OSPF", async () => {
        const draft = configurationOf(router);
        draft.protocols = [{ type: ProtocolType.Acl, enabled: true, acl }];
        await store.configureDevice(topologyId, router.id, draft);

        const [savedRouter] = (await store.loadTopology(topologyId)).devices;
        assert.deepStrictEqual(configurationOf(savedRouter).protocols, draft.protocols);
        assert.strictEqual(await new ConfigModule(store).generateForTopology(topologyId), 1);
        assert.strictEqual(await readConfig(), [
            `hostname ${router.hostname}`,
            "ip access-list extended LAB_FILTER",
            " deny ip host 192.0.2.4 any",
            " permit ip 192.0.2.0 0.0.0.255 any",
            " deny ip any host 198.51.100.1",
            " exit",
            `interface ${router.interfaces[0].name}`,
            " ip access-group LAB_FILTER in",
            " exit",
            "end"
        ].join("\n"));
    });

    test("generates an unbound ACL alongside RIP and skips disabled ACLs", async () => {
        delete acl.binding;
        const draft = configurationOf(router);
        draft.protocols = [
            { type: ProtocolType.Acl, enabled: true, acl },
            { type: ProtocolType.Rip, enabled: true, rip: { version: 2, noAutoSummary: true, networks: [{ address: "10.0.0.0" }] } }
        ];
        await store.configureDevice(topologyId, router.id, draft);
        const generator = new ConfigModule(store);
        assert.strictEqual(await generator.generateForTopology(topologyId), 1);
        const config = await readConfig();
        assert.ok(config.includes(" network 10.0.0.0\n exit\nip access-list extended LAB_FILTER"));
        assert.ok(!config.includes("ip access-group"));

        draft.protocols = [{ type: ProtocolType.Acl, enabled: false, acl }];
        await store.configureDevice(topologyId, router.id, draft);
        assert.strictEqual(await generator.generateForTopology(topologyId), 0);
    });

    test("rejects an invalid wildcard and a binding to an unknown interface", async () => {
        acl.rules[0].sourceWildcard = "0.0.0.256";
        acl.binding = { interfaceId: "unknown", direction: "out" };
        const draft = configurationOf(router);
        draft.protocols = [{ type: ProtocolType.Acl, enabled: true, acl }];
        await assert.rejects(store.configureDevice(topologyId, router.id, draft),
            (error: unknown) => error instanceof DeviceConfigurationValidationError &&
                error.errors.some(({ code }) => code === "acl-wildcard-invalid") &&
                error.errors.some(({ code }) => code === "acl-interface-invalid"));
    });
});
