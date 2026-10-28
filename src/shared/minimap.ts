/**
 * Mathematik der Mini-Map – reine Funktionen
 * minimap = welt * scale + offset
 */

import { Bounds, boundsCenter, boundsHeight, boundsWidth, Point, unionBounds } from "./geometry";

export interface MinimapTransform {
    scale: number;
    offsetX: number;
    offsetY: number;
}

export function computeMinimapTransform(
    content: Bounds | undefined,
    visible: Bounds,
    width: number,
    height: number,
    padding: number
): MinimapTransform {
    const world = unionBounds(content, visible) ?? visible;
    const availableWidth = Math.max(1, width - 2 * padding);
    const availableHeight = Math.max(1, height - 2 * padding);
    const scale = Math.min(
        availableWidth / Math.max(1, boundsWidth(world)),
        availableHeight / Math.max(1, boundsHeight(world))
    );
    const center = boundsCenter(world);
    return {
        scale,
        offsetX: width / 2 - center.x * scale,
        offsetY: height / 2 - center.y * scale,
    };
}

export function worldToMinimap(transform: MinimapTransform, world: Point): Point {
    return {
        x: world.x * transform.scale + transform.offsetX,
        y: world.y * transform.scale + transform.offsetY,
    };
}

export function minimapToWorld(transform: MinimapTransform, point: Point): Point {
    return {
        x: (point.x - transform.offsetX) / transform.scale,
        y: (point.y - transform.offsetY) / transform.scale,
    };
}
