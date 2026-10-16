/**
 * Mini-Map (Übersicht + Navigation)
 * 
 * Navigation:
 *  - Klick: Ansicht springt dorthin (zentriert)
 *  - Ziehen (auch des Ausschnitt-Rechtecks): Ansicht folgt
 *  - Mausrad: zoomt die Ansicht um den Punkt unter dem Mauszeiger
 */

import { boundsOfPoints, containsPoint, expandBounds, Point } from "../shared/geometry";
import {
    computeMinimapTransform,
    MinimapTransform,
    minimapToWorld,
    worldToMinimap,
} from "../shared/minimap";
import { centerOn, visibleWorldBounds, worldToScreen, zoomAt } from "../shared/viewport";
import type { TopologyEditor } from "./editor";
import { DEVICE_TYPE_COLOR } from "./icons";
import { DEVICE_EXTENT } from "./renderer";
import { htmlElement } from "./svg";

const WIDTH = 200;
const HEIGHT = 140;
const PADDING = 8;

interface DragState {
    pointerId: number;
    transform: MinimapTransform;
    grabOffset: Point;
}

export class Minimap {
    private readonly root: HTMLElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D;
    private readonly toggle: HTMLButtonElement;
    private transform: MinimapTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    private drawScheduled = false;
    private drag: DragState | undefined;
    private collapsed: boolean;

    constructor(private readonly editor: TopologyEditor, container: HTMLElement) {
        this.root = htmlElement("section", "minimap");
        this.root.setAttribute("aria-label", "Mini-Map");

        const header = htmlElement("div", "minimap-header");
        header.append(htmlElement("span", "minimap-title", "Übersicht"));
        this.toggle = htmlElement("button", "minimap-toggle");
        this.toggle.type = "button";
        this.toggle.addEventListener("click", () => this.setCollapsed(!this.collapsed));
        header.append(this.toggle);

        this.canvas = htmlElement("canvas", "minimap-canvas");
        this.canvas.title = "Klicken oder ziehen, um zu navigieren · Mausrad zoomt";
        this.canvas.style.width = `${WIDTH}px`;
        this.canvas.style.height = `${HEIGHT}px`;
        const context = this.canvas.getContext("2d");
        if (!context) {
            throw new Error("Canvas 2D wird nicht unterstützt.");
        }
        this.context = context;

        this.root.append(header, this.canvas);
        container.append(this.root);

        this.collapsed = editor.persistedState.minimapCollapsed === true;
        this.setCollapsed(this.collapsed, false);

        this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
        this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
        this.canvas.addEventListener("pointerup", (event) => this.endDrag(event));
        this.canvas.addEventListener("pointercancel", (event) => this.endDrag(event));
        this.canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });

        editor.onViewportChange(() => this.scheduleDraw());
        editor.onModelChange(() => this.scheduleDraw());
        // Theme-Wechsel (Farben aus CSS-Variablen) ebenfalls berücksichtigen.
        new MutationObserver(() => this.scheduleDraw()).observe(document.body, {
            attributes: true,
            attributeFilter: ["class"],
        });
        this.scheduleDraw();
    }

    private setCollapsed(collapsed: boolean, persist = true): void {
        this.collapsed = collapsed;
        this.root.classList.toggle("collapsed", collapsed);
        this.toggle.textContent = collapsed ? "▴" : "▾";
        this.toggle.title = collapsed ? "Mini-Map einblenden" : "Mini-Map ausblenden";
        this.toggle.setAttribute("aria-label", this.toggle.title);
        this.toggle.setAttribute("aria-expanded", String(!collapsed));
        if (persist) {
            this.editor.savePersistedState({ minimapCollapsed: collapsed });
        }
        this.scheduleDraw();
    }

    private scheduleDraw(): void {
        if (this.drawScheduled || this.collapsed) {
            return;
        }
        this.drawScheduled = true;
        requestAnimationFrame(() => {
            this.drawScheduled = false;
            this.draw();
        });
    }

    private draw(): void {
        const ratio = window.devicePixelRatio || 1;
        if (this.canvas.width !== WIDTH * ratio || this.canvas.height !== HEIGHT * ratio) {
            this.canvas.width = WIDTH * ratio;
            this.canvas.height = HEIGHT * ratio;
        }
        const ctx = this.context;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, WIDTH, HEIGHT);

        const model = this.editor.getModel();
        const viewport = this.editor.getViewport();
        const size = this.editor.getCanvasSize();
        const visible = visibleWorldBounds(viewport, size.width, size.height);
        const positions = new Map<string, Point>();
        for (const id of model.devices.keys()) {
            positions.set(id, this.editor.positionOf(id));
        }

        const contentBounds = boundsOfPoints(positions.values());
        const content = contentBounds
            ? expandBounds(contentBounds, Math.max(DEVICE_EXTENT.left, DEVICE_EXTENT.bottom))
            : undefined;
        this.transform = this.drag?.transform ?? computeMinimapTransform(content, visible, WIDTH, HEIGHT, PADDING);
        const t = this.transform;

        const style = getComputedStyle(document.body);
        const foreground = style.getPropertyValue("--vscode-foreground").trim() || "#888";
        const accent = style.getPropertyValue("--vscode-focusBorder").trim() || "#007fd4";

        // Verbindungen
        ctx.strokeStyle = foreground;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const connection of model.connections) {
            const a = positions.get(connection.deviceA);
            const b = positions.get(connection.deviceB);
            if (!a || !b) {
                continue;
            }
            const pa = worldToMinimap(t, a);
            const pb = worldToMinimap(t, b);
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Geräte als vereinfachte Quadrate
        const deviceSize = Math.max(3, Math.min(10, 44 * t.scale));
        for (const device of model.devices.values()) {
            const position = positions.get(device.id);
            if (!position) {
                continue;
            }
            const p = worldToMinimap(t, position);
            ctx.fillStyle = DEVICE_TYPE_COLOR[device.type];
            ctx.fillRect(p.x - deviceSize / 2, p.y - deviceSize / 2, deviceSize, deviceSize);
        }

        // Sichtbarer Ausschnitt
        const topLeft = worldToMinimap(t, { x: visible.minX, y: visible.minY });
        const bottomRight = worldToMinimap(t, { x: visible.maxX, y: visible.maxY });
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.12;
        ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);

        this.canvas.setAttribute(
            "aria-label",
            `Mini-Map: ${model.devices.size} Geräte, Ausschnitt ${Math.round(viewport.zoom * 100)} %`
        );
    }

    private localPoint(event: PointerEvent | WheelEvent): Point {
        const rect = this.canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    private onPointerDown(event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        this.canvas.setPointerCapture(event.pointerId);

        const viewport = this.editor.getViewport();
        const size = this.editor.getCanvasSize();
        const visible = visibleWorldBounds(viewport, size.width, size.height);
        const transform = this.transform;
        const world = minimapToWorld(transform, this.localPoint(event));

        let grabOffset: Point = { x: 0, y: 0 };
        if (containsPoint(visible, world)) {
            const center = { x: (visible.minX + visible.maxX) / 2, y: (visible.minY + visible.maxY) / 2 };
            grabOffset = { x: world.x - center.x, y: world.y - center.y };
        } else {
            this.editor.setViewport(centerOn(viewport, world, size.width, size.height));
        }
        this.drag = { pointerId: event.pointerId, transform, grabOffset };
        this.root.classList.add("dragging");
    }

    private onPointerMove(event: PointerEvent): void {
        if (!this.drag || this.drag.pointerId !== event.pointerId) {
            return;
        }
        const world = minimapToWorld(this.drag.transform, this.localPoint(event));
        const target = { x: world.x - this.drag.grabOffset.x, y: world.y - this.drag.grabOffset.y };
        const size = this.editor.getCanvasSize();
        this.editor.setViewport(centerOn(this.editor.getViewport(), target, size.width, size.height));
    }

    private endDrag(event: PointerEvent): void {
        if (!this.drag || this.drag.pointerId !== event.pointerId) {
            return;
        }
        this.drag = undefined;
        this.root.classList.remove("dragging");
        this.scheduleDraw();
    }

    private onWheel(event: WheelEvent): void {
        event.preventDefault();
        const viewport = this.editor.getViewport();
        const world = minimapToWorld(this.transform, this.localPoint(event));
        const anchor = worldToScreen(viewport, world);
        const factor = Math.exp(-event.deltaY * 0.0015 * (event.deltaMode === 1 ? 20 : 1));
        this.editor.setViewport(zoomAt(viewport, anchor, viewport.zoom * factor));
    }
}
