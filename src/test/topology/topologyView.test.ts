import * as assert from "assert";
import { parseWebviewMessage } from "../../modules/topology/view/parseWebviewMessage";
import { computeMinimapTransform, worldToMinimap } from "../../shared/minimap";
import { fitBounds, screenToWorld, visibleWorldBounds, zoomAt } from "../../shared/viewport";

suite("Topologieansicht ", () => {
    test("Gültige Nachrichten aus der Webview werden akzeptiert", () => {
        assert.deepStrictEqual(
            parseWebviewMessage({ type: "addDevice", deviceType: "router", position: { x: 1, y: 2 } }),
            { type: "addDevice", deviceType: "router", position: { x: 1, y: 2 } }
        );
    });

    test("Ungültige Nachrichten aus der Webview werden verworfen", () => {
        const invalid: unknown[] = [
            null,
            { type: "unbekannt" },
            { type: "addDevice", deviceType: "firewall", position: { x: 0, y: 0 } },
            { type: "addDevice", deviceType: "router", position: { x: Number.NaN, y: 0 } },
            { type: "deleteDevice", deviceId: "" },
        ];
        for (const message of invalid) {
            assert.strictEqual(parseWebviewMessage(message), undefined, JSON.stringify(message));
        }
    });

    test("Zoom hält den Punkt unter dem Mauszeiger fest", () => {
        const viewport = { offsetX: 10, offsetY: 20, zoom: 1 };
        const cursor = { x: 300, y: 200 };
        const before = screenToWorld(viewport, cursor);
        const after = screenToWorld(zoomAt(viewport, cursor, 1.8), cursor);
        assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
    });

    test("\"Alles anzeigen\" zeigt den gesamten Inhalt", () => {
        const content = { minX: -500, minY: -100, maxX: 1500, maxY: 900 };
        const visible = visibleWorldBounds(fitBounds(content, 800, 600, 20), 800, 600);
        assert.ok(visible.minX <= content.minX && visible.maxX >= content.maxX);
        assert.ok(visible.minY <= content.minY && visible.maxY >= content.maxY);
    });

    test("Mini-Map zeigt Geräte UND sichtbaren Ausschnitt", () => {
        const content = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };
        const visible = { minX: 3000, minY: 0, maxX: 3800, maxY: 600 };
        const t = computeMinimapTransform(content, visible, 200, 140, 8);
        for (const corner of [{ x: content.minX, y: content.minY }, { x: visible.maxX, y: visible.maxY }]) {
            const p = worldToMinimap(t, corner);
            assert.ok(p.x >= 0 && p.x <= 200 && p.y >= 0 && p.y <= 140, JSON.stringify(p));
        }
    });
});
