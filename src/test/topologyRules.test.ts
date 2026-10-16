import * as assert from "assert";
import { nextHostname, validateHostname } from "../modules/topology/hostname";
import { migrateTopology, UnsupportedSchemaVersionError } from "../modules/topology/migrations";
import { buildDemoPlan } from "../modules/topology/demo";

suite("Topologie-Regeln (H2a)", () => {
    test("validateHostname prüft die IOS-Regeln", () => {
        for (const valid of ["R1", "Core-Router-1"]) {
            assert.strictEqual(validateHostname(valid), undefined, valid);
        }
        for (const invalid of ["", "1R", "R 1", "R1-", "x".repeat(64)]) {
            assert.notStrictEqual(validateHostname(invalid), undefined, JSON.stringify(invalid));
        }
    });

    test("nextHostname nimmt höchste Nummer + 1 (Lücken werden nicht wiederverwendet)", () => {
        assert.strictEqual(nextHostname("router", []), "R1");
        assert.strictEqual(nextHostname("router", ["R1", "R3", "SW7"]), "R4");
    });

    test("Dateien aus einer neueren Version werden abgelehnt", () => {
        assert.throws(
            () => migrateTopology({ schemaVersion: 99, devices: [], connections: [] }),
            UnsupportedSchemaVersionError
        );
    });

    test("Demo-Bauplan erzeugt genau n Geräte ohne Überlappung", () => {
        const plan = buildDemoPlan(50);
        assert.strictEqual(plan.devices.length, 50);
        const positions = new Set(plan.devices.map((d) => `${d.position.x},${d.position.y}`));
        assert.strictEqual(positions.size, 50);
    });
});
