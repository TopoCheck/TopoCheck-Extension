/**
 * Zeichnet die Topologie als SVG
 *
 */

import type { DeviceType } from "../modules/topology/models";
import { GRID_SIZE, Point } from "../shared/geometry";
import type { Viewport } from "../shared/viewport";
import { DEVICE_TYPE_LABEL, ICON_SIZE, iconHref } from "./icons";
import { svgElement } from "./svg";
import type { ViewModel } from "./viewModel";

export const LABEL_MIN_ZOOM = 0.45;

export const DEVICE_EXTENT = { left: 40, right: 40, top: 32, bottom: 50 };

interface DeviceElement {
    group: SVGGElement;
    label: SVGTextElement;
    use: SVGUseElement;
    type: DeviceType;
    labelText: string;
}

interface ConnectionElement {
    line: SVGLineElement;
    deviceA: string;
    deviceB: string;
}

export class SceneRenderer {
    readonly svg: SVGSVGElement;
    private readonly gridPattern: SVGPatternElement;
    private readonly world: SVGGElement;
    private readonly connectionLayer: SVGGElement;
    private readonly deviceLayer: SVGGElement;
    private readonly ghost: SVGGElement;
    private readonly ghostUse: SVGUseElement;

    private readonly devices = new Map<string, DeviceElement>();
    private readonly connections = new Map<string, ConnectionElement>();
    private readonly connectionsByDevice = new Map<string, Set<string>>();
    private readonly positions = new Map<string, Point>();
    private selectedId: string | undefined;

    constructor(container: HTMLElement) {
        this.svg = svgElement("svg", {
            class: "scene",
            role: "application",
            "aria-label": "Topologie-Zeichenfläche",
        });
        this.svg.dataset.vscodeContext = JSON.stringify({ preventDefaultContextMenuItems: true });

        const defs = svgElement("defs");
        this.gridPattern = svgElement("pattern", {
            id: "grid",
            width: GRID_SIZE,
            height: GRID_SIZE,
            patternUnits: "userSpaceOnUse",
        });
        this.gridPattern.append(svgElement("circle", { cx: 0.75, cy: 0.75, r: 0.75, class: "grid-dot" }));
        defs.append(this.gridPattern);

        const gridRect = svgElement("rect", {
            class: "grid",
            width: "100%",
            height: "100%",
            fill: "url(#grid)",
        });

        this.world = svgElement("g", { class: "world" });
        this.connectionLayer = svgElement("g", { class: "connections" });
        this.deviceLayer = svgElement("g", { class: "devices" });
        this.ghost = svgElement("g", { class: "ghost", visibility: "hidden" });
        this.ghostUse = svgElement("use", {
            x: -ICON_SIZE / 2,
            y: -ICON_SIZE / 2,
            width: ICON_SIZE,
            height: ICON_SIZE,
        });
        this.ghost.append(this.ghostUse);

        this.world.append(this.connectionLayer, this.deviceLayer, this.ghost);
        this.svg.append(defs, gridRect, this.world);
        container.append(this.svg);
    }

    setViewport(viewport: Viewport): void {
        const transform = `translate(${viewport.offsetX} ${viewport.offsetY}) scale(${viewport.zoom})`;
        this.world.setAttribute("transform", transform);
        this.gridPattern.setAttribute("patternTransform", transform);
        this.svg.classList.toggle("grid-hidden", viewport.zoom < 0.5);
        this.svg.classList.toggle("labels-hidden", viewport.zoom < LABEL_MIN_ZOOM);
    }

    sync(model: ViewModel, positionOf: (id: string) => Point): void {
        for (const [id, element] of this.devices) {
            if (!model.devices.has(id)) {
                element.group.remove();
                this.devices.delete(id);
                this.positions.delete(id);
            }
        }

        for (const device of model.devices.values()) {
            let element = this.devices.get(device.id);
            if (!element) {
                element = this.createDevice(device.id, device.type);
                this.devices.set(device.id, element);
                this.deviceLayer.append(element.group);
            }
            if (element.labelText !== device.label) {
                element.label.textContent = device.label;
                element.labelText = device.label;
                element.group.setAttribute(
                    "aria-label",
                    `${DEVICE_TYPE_LABEL[device.type]} ${device.label}`
                );
            }
            this.placeDevice(device.id, element, positionOf(device.id));
        }

        this.syncConnections(model);
        this.setSelected(this.selectedId && model.devices.has(this.selectedId) ? this.selectedId : undefined);
    }

    setDevicePosition(id: string, position: Point): void {
        const element = this.devices.get(id);
        if (element) {
            this.placeDevice(id, element, position);
        }
    }

    setSelected(id: string | undefined): void {
        if (this.selectedId === id) {
            return;
        }
        if (this.selectedId) {
            this.devices.get(this.selectedId)?.group.classList.remove("selected");
        }
        this.selectedId = id;
        if (id) {
            const element = this.devices.get(id);
            element?.group.classList.add("selected");
            if (element) {
                this.deviceLayer.append(element.group);
            }
        }
    }

    setDragging(id: string | undefined): void {
        for (const [deviceId, element] of this.devices) {
            element.group.classList.toggle("dragging", deviceId === id);
        }
    }

    focusDevice(id: string): void {
        this.devices.get(id)?.group.focus({ preventScroll: true });
    }

    showGhost(type: DeviceType | undefined, position?: Point): void {
        if (!type || !position) {
            this.ghost.setAttribute("visibility", "hidden");
            return;
        }
        this.ghostUse.setAttribute("href", iconHref(type));
        this.ghost.setAttribute("transform", `translate(${position.x} ${position.y})`);
        this.ghost.setAttribute("visibility", "visible");
    }

    deviceIdAt(target: EventTarget | null): string | undefined {
        if (!(target instanceof Element)) {
            return undefined;
        }
        const group = target.closest<SVGGElement>("[data-device-id]");
        return group?.dataset.deviceId;
    }

    private createDevice(id: string, type: DeviceType): DeviceElement {
        const group = svgElement("g", {
            class: `device device-${type}`,
            tabindex: 0,
            role: "button",
        });
        group.dataset.deviceId = id;
        group.dataset.vscodeContext = JSON.stringify({
            webviewSection: "device",
            deviceId: id,
            preventDefaultContextMenuItems: true,
        });

        const hitArea = svgElement("rect", {
            class: "device-frame",
            x: -DEVICE_EXTENT.left,
            y: -DEVICE_EXTENT.top,
            width: DEVICE_EXTENT.left + DEVICE_EXTENT.right,
            height: DEVICE_EXTENT.top + DEVICE_EXTENT.bottom,
            rx: 6,
        });
        const use = svgElement("use", {
            href: iconHref(type),
            x: -ICON_SIZE / 2,
            y: -ICON_SIZE / 2,
            width: ICON_SIZE,
            height: ICON_SIZE,
        });
        const label = svgElement("text", {
            class: "device-label",
            x: 0,
            y: ICON_SIZE / 2 + 16,
            "text-anchor": "middle",
        });

        group.append(hitArea, use, label);
        return { group, label, use, type, labelText: "" };
    }

    private placeDevice(id: string, element: DeviceElement, position: Point): void {
        const previous = this.positions.get(id);
        if (previous && previous.x === position.x && previous.y === position.y) {
            return;
        }
        this.positions.set(id, position);
        element.group.setAttribute("transform", `translate(${position.x} ${position.y})`);

        for (const connectionId of this.connectionsByDevice.get(id) ?? []) {
            this.updateLine(connectionId);
        }
    }

    private syncConnections(model: ViewModel): void {
        const wanted = new Set(model.connections.map((c) => c.id));
        for (const [id, element] of this.connections) {
            if (!wanted.has(id)) {
                element.line.remove();
                this.connections.delete(id);
            }
        }

        this.connectionsByDevice.clear();
        for (const connection of model.connections) {
            let element = this.connections.get(connection.id);
            if (!element) {
                element = {
                    line: svgElement("line", { class: "connection" }),
                    deviceA: connection.deviceA,
                    deviceB: connection.deviceB,
                };
                this.connections.set(connection.id, element);
                this.connectionLayer.append(element.line);
            }
            element.deviceA = connection.deviceA;
            element.deviceB = connection.deviceB;

            for (const deviceId of [connection.deviceA, connection.deviceB]) {
                let set = this.connectionsByDevice.get(deviceId);
                if (!set) {
                    set = new Set();
                    this.connectionsByDevice.set(deviceId, set);
                }
                set.add(connection.id);
            }
            this.updateLine(connection.id);
        }
    }

    private updateLine(connectionId: string): void {
        const element = this.connections.get(connectionId);
        if (!element) {
            return;
        }
        const a = this.positions.get(element.deviceA);
        const b = this.positions.get(element.deviceB);
        if (!a || !b) {
            return;
        }
        element.line.setAttribute("x1", String(a.x));
        element.line.setAttribute("y1", String(a.y));
        element.line.setAttribute("x2", String(b.x));
        element.line.setAttribute("y2", String(b.y));
    }
}
