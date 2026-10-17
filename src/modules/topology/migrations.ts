/**
 * Schema-Migrationen für gespeicherte Topologien.
 * 
 * Laden hat keine Seiteneffekte: die migrierte Fassung wird erst beim nächsten
 * Speichern geschrieben.
 */

import { ensureLayoutInvariant } from "./layout";
import { CURRENT_SCHEMA_VERSION, Topology } from "./models";

export class UnsupportedSchemaVersionError extends Error {
    constructor(readonly version: number) {
        super(
            `Die Topologie wurde mit einer neueren TopoCheck-Version erstellt (Schema ${version}, unterstützt: bis ${CURRENT_SCHEMA_VERSION}). Bitte TopoCheck aktualisieren.`
        );
        this.name = "UnsupportedSchemaVersionError";
    }
}

type RawTopology = Record<string, unknown>;

/** Migrationsschritte: Schlüssel = Ausgangsversion. */
const MIGRATIONS: Record<number, (raw: RawTopology) => RawTopology> = {
    1: (raw) => ({ ...raw, layout: { devices: {} }, schemaVersion: 2 }),
};

export function migrateTopology(raw: unknown): Topology {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("Ungültiges Topologie-Format: Objekt erwartet.");
    }

    let current = raw as RawTopology;
    let version =
        typeof current.schemaVersion === "number" ? current.schemaVersion : 1;

    if (version > CURRENT_SCHEMA_VERSION) {
        throw new UnsupportedSchemaVersionError(version);
    }

    while (version < CURRENT_SCHEMA_VERSION) {
        const step = MIGRATIONS[version];
        if (!step) {
            throw new Error(`Keine Migration von Schema ${version} vorhanden.`);
        }
        current = step(current);
        version = current.schemaVersion as number;
    }

    if (!Array.isArray(current.devices) || !Array.isArray(current.connections)) {
        throw new Error("Ungültiges Topologie-Format: devices/connections fehlen.");
    }

    const topology = current as unknown as Topology;
    ensureLayoutInvariant(topology);
    return topology;
}