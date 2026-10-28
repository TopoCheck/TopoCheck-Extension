/**
 * Zeichnet die Topologie als SVG
 */

import type { DeviceType } from "../modules/topology/models";
import { GRID_SIZE, Point } from "../shared/geometry";
import type { Viewport } from "../shared/viewport";
import { DEVICE_TYPE_LABEL, ICON_SIZE, iconHref } from "./icons";
import { svgElement } from "./svg";
import type { ViewConnection, ViewModel } from "./viewModel";

export const LABEL_MIN_ZOOM = 0.45;

export const DEVICE_EXTENT = { left: 58, right: 58, top: 32, bottom: 60 };

interface DeviceElement {
    group: SVGGElement;
    label: SVGTextElement;
    use: SVGUseElement;
    type: DeviceType;
    labelText: string;
}

interface ConnectionElement {
    line: SVGLineElement;
    labelA: SVGTextElement;
    labelB: SVGTextElement;
    deviceA: string;
    deviceB: string;
    interfaceAName: string;
    interfaceBName: string;
    laneOffset: number;
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
        defs.append(this.gridPattern, createSelectionOutlineFilter());

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
            y: ICON_SIZE / 2 + 12,
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
        const wanted = new Set(model.connections.map((connection) => connection.id));
        for (const [id, element] of this.connections) {
            if (!wanted.has(id)) {
                element.line.remove();
                element.labelA.remove();
                element.labelB.remove();
                this.connections.delete(id);
            }
        }

        this.connectionsByDevice.clear();

        // Jede Verbindung zwischen demselben Geräte-Paar bekommt eine eigene Spur.
        const groups = new Map<string, ViewConnection[]>();
        for (const connection of model.connections) {
            const pairKey = [connection.deviceA, connection.deviceB].sort().join("::");
            const group = groups.get(pairKey) ?? [];
            group.push(connection);
            groups.set(pairKey, group);
        }

        const offsets = new Map<string, number>();
        for (const group of groups.values()) {
            group.forEach((connection, index) => {
                offsets.set(connection.id, (index - (group.length - 1) / 2) * 10);
            });
        }

        for (const connection of model.connections) {
            let element = this.connections.get(connection.id);
            if (!element) {
                element = {
                    line: svgElement("line", { class: "connection" }),
                    labelA: svgElement("text", { class: "connection-label", "text-anchor": "start" }),
                    labelB: svgElement("text", { class: "connection-label", "text-anchor": "end" }),
                    deviceA: connection.deviceA,
                    deviceB: connection.deviceB,
                    interfaceAName: connection.interfaceAName,
                    interfaceBName: connection.interfaceBName,
                    laneOffset: 0,
                };
                this.connections.set(connection.id, element);
                this.connectionLayer.append(element.line, element.labelA, element.labelB);
            }

            element.deviceA = connection.deviceA;
            element.deviceB = connection.deviceB;
            element.interfaceAName = connection.interfaceAName;
            element.interfaceBName = connection.interfaceBName;
            element.laneOffset = offsets.get(connection.id) ?? 0;
            element.labelA.textContent = abbreviateInterface(connection.interfaceAName);
            element.labelB.textContent = abbreviateInterface(connection.interfaceBName);

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

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / length;
        const uy = dy / length;

        // Einheitliche Normale anhand der alphabetisch kanonischen Richtung:
        // auch bei umgekehrter Reihenfolge der Endpunkte bleiben parallele Kabel getrennt.
        const canonicalForward = element.deviceA.localeCompare(element.deviceB) <= 0;
        const nx = (canonicalForward ? -uy : uy);
        const ny = (canonicalForward ? ux : -ux);
        const offsetX = nx * element.laneOffset;
        const offsetY = ny * element.laneOffset;

        element.line.setAttribute("x1", String(a.x + offsetX));
        element.line.setAttribute("y1", String(a.y + offsetY));
        element.line.setAttribute("x2", String(b.x + offsetX));
        element.line.setAttribute("y2", String(b.y + offsetY));

        const endpointDistance = Math.min(ICON_SIZE / 2 + 9, length * 0.25);
        const labelOffset = element.laneOffset + 5;

        element.labelA.setAttribute("x", String(a.x + ux * endpointDistance + nx * labelOffset));
        element.labelA.setAttribute("y", String(a.y + uy * endpointDistance + ny * labelOffset));
        element.labelB.setAttribute("x", String(b.x - ux * endpointDistance + nx * labelOffset));
        element.labelB.setAttribute("y", String(b.y - uy * endpointDistance + ny * labelOffset));

        element.labelA.setAttribute("text-anchor", dx >= 0 ? "start" : "end");
        element.labelB.setAttribute("text-anchor", dx >= 0 ? "end" : "start");
    }
}

export function abbreviateInterface(name: string): string {
    const knownPrefixes: Array<[string, string]> = [
        ["GigabitEthernet", "Gi"],
        ["FastEthernet", "Fa"],
        ["TenGigabitEthernet", "Te"],
        ["TwentyFiveGigE", "Twe"],
        ["FortyGigabitEthernet", "Fo"],
        ["HundredGigE", "Hu"],
        ["Ethernet", "Eth"],
        ["Serial", "Se"],
        ["Loopback", "Lo"],
        ["Port-channel", "Po"],
        ["PortChannel", "Po"],
    ];

    for (const [prefix, shortPrefix] of knownPrefixes) {
        if (name.startsWith(prefix)) {
            return shortPrefix + name.slice(prefix.length);
        }
    }
    return name;
}

function createSelectionOutlineFilter(): SVGFilterElement {
    const filter = svgElement("filter", {
        id: "selection-outline",
        x: "-25%",
        y: "-25%",
        width: "150%",
        height: "150%",
    });
    const threshold = svgElement("feComponentTransfer", { in: "SourceAlpha", result: "solid" });
    threshold.append(svgElement("feFuncA", { type: "discrete", tableValues: "0 1" }));
    filter.append(
        threshold,
        svgElement("feMorphology", { in: "solid", operator: "dilate", radius: 2, result: "grown" }),
        svgElement("feFlood", { class: "selection-outline-color", result: "color" }),
        svgElement("feComposite", { in: "color", in2: "grown", operator: "in", result: "outline" }),
        (() => {
            const merge = svgElement("feMerge");
            merge.append(
                svgElement("feMergeNode", { in: "outline" }),
                svgElement("feMergeNode", { in: "SourceGraphic" })
            );
            return merge;
        })()
    );
    return filter;
}
