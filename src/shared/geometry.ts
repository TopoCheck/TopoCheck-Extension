/**
 * Reine Geometrie-Hilfsfunktionen (ohne VS-Code- und ohne DOM-Abhängigkeit).
 *
 * Wird von der Extension (Store, Migration) und vom Webview-Frontend verwendet.
 * Dadurch gelten überall dieselben Regeln (z. B. Rastergröße) und die Funktionen
 * sind in normalen Unit-Tests ohne VS Code prüfbar.
 */

export interface Point {
    x: number;
    y: number;
}

export interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Rastergröße der Topologieansicht in Weltkoordinaten. */
export const GRID_SIZE = 20;

export function isFinitePoint(value: unknown): value is Point {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.x === "number" &&
        typeof candidate.y === "number" &&
        Number.isFinite(candidate.x) &&
        Number.isFinite(candidate.y)
    );
}

export function roundPoint(point: Point): Point {
    return { x: Math.round(point.x), y: Math.round(point.y) };
}

export function snapToGrid(point: Point, gridSize: number = GRID_SIZE): Point {
    return {
        x: Math.round(point.x / gridSize) * gridSize,
        y: Math.round(point.y / gridSize) * gridSize,
    };
}

/** Kleinstes achsenparalleles Rechteck um alle Punkte (oder undefined bei leerer Liste). */
export function boundsOfPoints(points: Iterable<Point>): Bounds | undefined {
    let bounds: Bounds | undefined;
    for (const point of points) {
        if (!bounds) {
            bounds = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
            continue;
        }
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.maxY = Math.max(bounds.maxY, point.y);
    }
    return bounds;
}

export function unionBounds(a: Bounds | undefined, b: Bounds | undefined): Bounds | undefined {
    if (!a) {
        return b;
    }
    if (!b) {
        return a;
    }
    return {
        minX: Math.min(a.minX, b.minX),
        minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX),
        maxY: Math.max(a.maxY, b.maxY),
    };
}

export function expandBounds(bounds: Bounds, by: number): Bounds {
    return {
        minX: bounds.minX - by,
        minY: bounds.minY - by,
        maxX: bounds.maxX + by,
        maxY: bounds.maxY + by,
    };
}

export function boundsWidth(bounds: Bounds): number {
    return bounds.maxX - bounds.minX;
}

export function boundsHeight(bounds: Bounds): number {
    return bounds.maxY - bounds.minY;
}

export function boundsCenter(bounds: Bounds): Point {
    return {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
    };
}

export function containsPoint(bounds: Bounds, point: Point): boolean {
    return (
        point.x >= bounds.minX &&
        point.x <= bounds.maxX &&
        point.y >= bounds.minY &&
        point.y <= bounds.maxY
    );
}
