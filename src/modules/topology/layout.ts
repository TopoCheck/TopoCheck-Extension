/**
 * Hilfsfunktionen für das Layout einer Topologie (reine Funktionen, unit-testbar).
*/

import { GRID_SIZE, Point } from "../../shared/geometry";
import type { Position, Topology } from "./models";

/** Abstand zwischen automatisch platzierten Geräten (Vielfaches des Rasters). */
export const AUTO_PLACEMENT_SPACING = GRID_SIZE * 6;
/** Anzahl der Spalten bei automatischer Platzierung. */
export const AUTO_PLACEMENT_COLUMNS = 8;

/**
 * Erster freier Platz in einem Raster (zeilenweise von links oben).
 * Wird verwendet, wenn ein Gerät ohne Position angelegt oder eine alte Datei migriert wird.
 */
export function findFreeGridPosition(occupied: Iterable<Point>): Position {
    const taken = Array.from(occupied);
    const minDistance = AUTO_PLACEMENT_SPACING / 2;

    for (let slot = 0; ; slot++) {
        const candidate: Position = {
            x: (slot % AUTO_PLACEMENT_COLUMNS) * AUTO_PLACEMENT_SPACING,
            y: Math.floor(slot / AUTO_PLACEMENT_COLUMNS) * AUTO_PLACEMENT_SPACING,
        };
        const isFree = taken.every(
            (point) =>
                Math.abs(point.x - candidate.x) >= minDistance ||
                Math.abs(point.y - candidate.y) >= minDistance
        );
        if (isFree) {
            return candidate;
        }
    }
}

/**
 * Stellt die Layout-Invariante her: jedes Gerät hat genau einen Eintrag,
 * verwaiste Einträge werden entfernt. Verändert "topology" und gibt zurück,
 * ob etwas geändert wurde.
 */
export function ensureLayoutInvariant(topology: Topology): boolean {
    let changed = false;

    if (typeof topology.layout !== "object" || topology.layout === null) {
        topology.layout = { devices: {} };
        changed = true;
    }
    if (typeof topology.layout.devices !== "object" || topology.layout.devices === null) {
        topology.layout.devices = {};
        changed = true;
    }

    const positions = topology.layout.devices;
    const deviceIds = new Set(topology.devices.map((device) => device.id));

    for (const id of Object.keys(positions)) {
        if (!deviceIds.has(id)) {
            delete positions[id];
            changed = true;
        }
    }

    for (const device of topology.devices) {
        if (!positions[device.id]) {
            positions[device.id] = findFreeGridPosition(Object.values(positions));
            changed = true;
        }
    }

    return changed;
}