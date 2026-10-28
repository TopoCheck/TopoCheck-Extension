/**
 * Mathematik der Ansicht (Pan & Zoom) – reine Funktionen
 *
 * Eine Ansicht wird durch genau einen Zustand beschrieben: bildschirm = welt * zoom + offset
 * Hauptfläche und Mini-Map leiten sich beide aus diesem Zustand ab.
 */

import { Bounds, boundsCenter, boundsHeight, boundsWidth, Point } from "./geometry";

export interface Viewport {
    /** Verschiebung des Welt-Ursprungs auf dem Bildschirm in px. */
    offsetX: number;
    offsetY: number;
    /** Vergrößerungsfaktor (1 = 100 %). */
    zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;
export const DEFAULT_VIEWPORT: Viewport = { offsetX: 0, offsetY: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(viewport: Viewport, screen: Point): Point {
    return {
        x: (screen.x - viewport.offsetX) / viewport.zoom,
        y: (screen.y - viewport.offsetY) / viewport.zoom,
    };
}

export function worldToScreen(viewport: Viewport, world: Point): Point {
    return {
        x: world.x * viewport.zoom + viewport.offsetX,
        y: world.y * viewport.zoom + viewport.offsetY,
    };
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
    return { ...viewport, offsetX: viewport.offsetX + dx, offsetY: viewport.offsetY + dy };
}

/**
 * Zoomt so, dass der Weltpunkt unter "screenPoint" (z. B. Mauszeiger) an derselben
 * Bildschirmstelle bleibt – "Zoom zum Cursor".
 */
export function zoomAt(viewport: Viewport, screenPoint: Point, requestedZoom: number): Viewport {
    const zoom = clampZoom(requestedZoom);
    const anchor = screenToWorld(viewport, screenPoint);
    return {
        zoom,
        offsetX: screenPoint.x - anchor.x * zoom,
        offsetY: screenPoint.y - anchor.y * zoom,
    };
}

/** Sichtbarer Ausschnitt in Weltkoordinaten bei gegebener Größe der Zeichenfläche. */
export function visibleWorldBounds(viewport: Viewport, width: number, height: number): Bounds {
    const topLeft = screenToWorld(viewport, { x: 0, y: 0 });
    const bottomRight = screenToWorld(viewport, { x: width, y: height });
    return { minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y };
}

/** Verschiebt die Ansicht so, dass "world" in der Mitte der Zeichenfläche liegt (Zoom bleibt). */
export function centerOn(viewport: Viewport, world: Point, width: number, height: number): Viewport {
    return {
        zoom: viewport.zoom,
        offsetX: width / 2 - world.x * viewport.zoom,
        offsetY: height / 2 - world.y * viewport.zoom,
    };
}

/**
 * "Alles anzeigen": Ansicht, in der "bounds" vollständig (mit Rand) sichtbar ist.
 * Es wird nie über "maxZoom" hinaus vergrößert, damit wenige Geräte nicht riesig werden.
 */
export function fitBounds(
    bounds: Bounds,
    width: number,
    height: number,
    padding: number,
    maxZoom = 1
): Viewport {
    const availableWidth = Math.max(1, width - 2 * padding);
    const availableHeight = Math.max(1, height - 2 * padding);
    const contentWidth = Math.max(1, boundsWidth(bounds));
    const contentHeight = Math.max(1, boundsHeight(bounds));

    const zoom = clampZoom(
        Math.min(maxZoom, availableWidth / contentWidth, availableHeight / contentHeight)
    );
    return centerOn({ offsetX: 0, offsetY: 0, zoom }, boundsCenter(bounds), width, height);
}

export function isValidViewport(value: unknown): value is Viewport {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const v = value as Record<string, unknown>;
    return (
        typeof v.offsetX === "number" && Number.isFinite(v.offsetX) &&
        typeof v.offsetY === "number" && Number.isFinite(v.offsetY) &&
        typeof v.zoom === "number" && Number.isFinite(v.zoom) && v.zoom > 0
    );
}
