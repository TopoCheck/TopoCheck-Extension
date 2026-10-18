/**
 * Steuerung der Topologieansicht: Zustand, Interaktion und Kommunikation.
 *
 * Interaktionen:
 *  - Hinzufügen
 *  - Verschieben
 *  - Löschen
 *  - Verwalten
 *  - Ansicht
 *
 * Alle Ziehvorgänge laufen über Pointer Events (einheitlich für Maus, Touchpad und Stift).
 * Gespeichert wird erst beim Loslassen
 */

import type { DeviceType } from "../modules/topology/models";
import {
    boundsOfPoints,
    containsPoint,
    expandBounds,
    GRID_SIZE,
    Point,
    snapToGrid,
} from "../shared/geometry";
import type { ExtensionToWebviewMessage, TopologyViewState } from "../shared/protocol";
import {
    centerOn,
    DEFAULT_VIEWPORT,
    fitBounds,
    isValidViewport,
    panBy,
    screenToWorld,
    Viewport,
    zoomAt,
} from "../shared/viewport";
import { DEVICE_TYPE_LABEL, iconHref } from "./icons";
import { DEVICE_EXTENT, SceneRenderer } from "./renderer";
import { htmlElement, svgElement } from "./svg";
import { toViewModel, ViewModel } from "./viewModel";
import { vscodeApi } from "./vscodeApi";

/** Ab dieser Bewegung (in Bildschirm-px) gilt ein Klick als Ziehen. */
const DRAG_THRESHOLD = 4;
const ZOOM_STEP = 1.2;
const KEYBOARD_MOVE_DEBOUNCE_MS = 350;
const STATE_SAVE_DEBOUNCE_MS = 250;

type Gesture =
    | {
        kind: "device";
        pointerId: number;
        deviceId: string;
        startScreen: Point;
        grabOffset: Point;
        dragging: boolean;
    }
    | { kind: "pan"; pointerId: number; lastScreen: Point; moved: boolean }
    | {
        kind: "palette";
        pointerId: number;
        deviceType: DeviceType;
        startClient: Point;
        dragging: boolean;
    };

export class TopologyEditor {
    private readonly renderer: SceneRenderer;
    private readonly canvas: HTMLElement;
    private readonly interfacePanel: HTMLElement;
    private readonly interfaceASelect: HTMLSelectElement;
    private readonly interfaceBSelect: HTMLSelectElement;
    private readonly connectionList: HTMLElement;
    private readonly emptyState: HTMLElement;
    private readonly hint: HTMLElement;
    private readonly nameLabel: HTMLElement;
    private readonly zoomLabel: HTMLButtonElement;
    private readonly paletteButtons = new Map<DeviceType, HTMLButtonElement>();
    readonly corner: HTMLElement;

    private model: ViewModel = { name: "", devices: new Map(), connections: [] };
    private hasReceivedState = false;
    private selectedId: string | undefined;
    private viewport: Viewport = DEFAULT_VIEWPORT;
    private canvasSize = { width: 0, height: 0 };
    private canvasRect: DOMRect | undefined;

    /** Optimistisch angezeigte Positionen, bis der Store sie bestätigt */
    private readonly pendingPositions = new Map<string, Point>();
    private readonly keyboardMoves = new Map<string, Point>();
    private keyboardMoveTimer: number | undefined;

    private gesture: Gesture | undefined;
    private placementType: DeviceType | undefined;
    private lastPointerScreen: Point | undefined;
    private selectNextAddedDevice = false;

    private saveStateTimer: number | undefined;
    private readonly viewState: TopologyViewState;
    private readonly viewportListeners: ((viewport: Viewport) => void)[] = [];
    private readonly modelListeners: (() => void)[] = [];
    private readonly interfacePopup: HTMLElement;

    private readonly cableButton: HTMLButtonElement;
    private readonly connectButton: HTMLButtonElement;

    private cableMode = false;
    private cableFirstDeviceId: string | undefined;
    private cableFirstInterfaceId: string | undefined;
    private cableSecondDeviceId: string | undefined;
    private cableSecondInterfaceId: string | undefined;

    private readonly interfaceOverview: HTMLElement;
    private readonly interfacePanelToggle: HTMLButtonElement;

    constructor(root: HTMLElement, topologyId: string) {
        const saved = vscodeApi.getState();
        this.viewState = saved?.topologyId === topologyId ? saved : { topologyId };
        if (isValidViewport(this.viewState.viewport)) {
            this.viewport = this.viewState.viewport;
        }

        // Werkzeugleiste
        const toolbar = htmlElement("header", "toolbar");
        const palette = htmlElement("div", "palette");
        palette.setAttribute("role", "toolbar");
        palette.setAttribute("aria-label", "Geräte hinzufügen");
        for (const type of ["router", "switch", "pc"] as const) {
            const button = this.createPaletteButton(type);
            this.paletteButtons.set(type, button);
            palette.append(button);
        }

        this.cableButton = htmlElement("button", "palette-item", "Verkabeln");
        this.cableButton.type = "button";
        this.cableButton.title = "Zwei Geräte über freie Interfaces verbinden";
        this.cableButton.setAttribute("aria-pressed", "false");
        this.cableButton.addEventListener("click", () => {
            this.setCableMode(!this.cableMode);
        });
        palette.append(this.cableButton);
        this.nameLabel = htmlElement("span", "topology-name");
        toolbar.append(palette, htmlElement("div", "toolbar-spacer"), this.nameLabel);

        // Zeichenfläche
        this.canvas = htmlElement("main", "canvas");
        this.renderer = new SceneRenderer(this.canvas);

        this.emptyState = htmlElement("div", "empty-state");
        this.emptyState.innerHTML =
            "<strong>Noch keine Geräte</strong>" +
            "<span>Ziehe einen Router, Switch oder PC aus der Leiste hierher –<br>oder klicke ein Gerät an und dann auf die Fläche.</span>" +
            "<span class=\"shortcuts\"><kbd>Entf</kbd> löschen · <kbd>F2</kbd> umbenennen · <kbd>Strg</kbd>+Mausrad zoomen</span>";

        this.hint = htmlElement("div", "hint");
        this.hint.setAttribute("role", "status");

        this.interfacePopup = htmlElement("div", "interface-popup");
        this.interfacePopup.hidden = true;
        this.interfacePopup.setAttribute("role", "dialog");
        this.interfacePopup.setAttribute("aria-label", "Interface auswählen");

        this.corner = htmlElement("div", "corner");
        const zoomControls = htmlElement("div", "zoom-controls");
        zoomControls.setAttribute("role", "group");
        zoomControls.setAttribute("aria-label", "Zoom");
        const zoomOut = this.createToolButton("−", "Verkleinern (-)", () => this.zoomBy(1 / ZOOM_STEP));
        this.zoomLabel = this.createToolButton("100 %", "Auf 100 % setzen (1)", () => this.zoomTo(1));
        this.zoomLabel.classList.add("zoom-label");
        const zoomIn = this.createToolButton("+", "Vergrößern (+)", () => this.zoomBy(ZOOM_STEP));
        const fit = this.createToolButton("⤢", "Alles anzeigen (0)", () => this.fitToContent());
        zoomControls.append(zoomOut, this.zoomLabel, zoomIn, fit);
        this.corner.append(zoomControls);

                
        this.canvas.append(
            this.emptyState,
            this.hint,
            this.corner,
            this.interfacePopup
        );
        
        // Interface-Panel
        this.interfacePanel = htmlElement("aside", "interface-panel");
        const panelTitle = htmlElement("h2", "interface-panel-title", "Interfaces");

        const connectTitle = htmlElement("h3", "interface-section-title", "Verbindung erstellen");

        this.interfaceASelect = document.createElement("select");
        this.interfaceASelect.className = "interface-select";
        this.interfaceASelect.setAttribute("aria-label", "Erstes Interface");

        this.interfaceBSelect = document.createElement("select");
        this.interfaceBSelect.className = "interface-select";
        this.interfaceBSelect.setAttribute("aria-label", "Zweites Interface");

        this.connectButton = htmlElement(
            "button",
            "interface-action",
            "Verbindung erstellen"
        );
        this.connectButton.type = "button";
        this.connectButton.disabled = true;

        // Interface-Auswahl erfolgt künftig über das Popup am Gerät.
        connectTitle.hidden = true;
        this.interfaceASelect.hidden = true;
        this.interfaceBSelect.hidden = true;
        this.connectButton.hidden = true;

        this.interfaceASelect.addEventListener("change", () => {
            this.cableFirstInterfaceId = this.interfaceASelect.value || undefined;

            if (this.cableFirstInterfaceId) {
                this.showHint("Klicke jetzt das zweite Gerät an.");
            } else {
                this.showHint("Wähle das erste Interface aus.");
            }

            this.renderInterfacePanel();
        });

        this.interfaceBSelect.addEventListener("change", () => {
            this.cableSecondInterfaceId = this.interfaceBSelect.value || undefined;

            if (this.cableSecondInterfaceId) {
                this.showHint("Klicke auf „Verbindung erstellen“.");
            } else {
                this.showHint("Wähle das zweite Interface aus.");
            }

            this.renderInterfacePanel();
        });

        this.connectButton.type = "button";
        this.connectButton.addEventListener("click", () => {
            const interfaceAId = this.cableFirstInterfaceId;
            const interfaceBId = this.cableSecondInterfaceId;

            if (!interfaceAId || !interfaceBId) {
                this.showHint("Wähle beide Interfaces aus.");
                return;
            }

            if (this.cableFirstDeviceId === this.cableSecondDeviceId) {
                this.showHint("Wähle zwei unterschiedliche Geräte.");
                return;
            }

            vscodeApi.postMessage({
                type: "addConnection",
                interfaceAId,
                interfaceBId,
            });

            this.setCableMode(false);
        });

        const connectionsTitle = htmlElement("h3", "interface-section-title", "Verbindungen");
        this.connectionList = htmlElement("div", "connection-list");
        this.interfaceOverview = htmlElement("div", "interface-overview");

        this.interfacePanel.append(
            panelTitle,
            connectTitle,
            this.interfaceASelect,
            this.interfaceBSelect,
            this.connectButton,
            connectionsTitle,
            this.connectionList,
            this.interfaceOverview
        );

        this.interfacePanelToggle = htmlElement(
            "button",
            "interface-panel-toggle",
            "›"
        );
        this.interfacePanelToggle.type = "button";
        this.interfacePanelToggle.title = "Interface-Fenster einklappen";
        this.interfacePanelToggle.setAttribute("aria-label", this.interfacePanelToggle.title);

        this.interfacePanelToggle.addEventListener("click", () => {
            const collapsed = this.interfacePanel.classList.toggle("collapsed");

            this.interfacePanelToggle.textContent = collapsed ? "‹" : "›";
            this.interfacePanelToggle.title = collapsed
                ? "Interface-Fenster ausklappen"
                : "Interface-Fenster einklappen";
            this.interfacePanelToggle.setAttribute(
                "aria-label",
                this.interfacePanelToggle.title
            );
        });


        const workspace = htmlElement("div", "workspace");

        workspace.append(
            this.canvas,
            this.interfacePanel,
            this.interfacePanelToggle
        );

        root.append(toolbar, workspace);


        this.registerEvents();
        new ResizeObserver(() => this.onResize()).observe(this.canvas);
        this.onResize();
        this.applyViewport(this.viewport, false);
    }

    // -------- öffentliche API

    getViewport(): Viewport {
        return this.viewport;
    }

    getCanvasSize(): { width: number; height: number } {
        return this.canvasSize;
    }

    getModel(): ViewModel {
        return this.model;
    }

    positionOf(id: string): Point {
        return this.pendingPositions.get(id) ?? this.model.devices.get(id)?.position ?? { x: 0, y: 0 };
    }

    setViewport(viewport: Viewport): void {
        this.applyViewport(viewport, true);
    }

    onViewportChange(listener: (viewport: Viewport) => void): void {
        this.viewportListeners.push(listener);
    }

    onModelChange(listener: () => void): void {
        this.modelListeners.push(listener);
    }

    private notifyModelListeners(): void {
    for (const listener of this.modelListeners) {
        listener();
    }
}

    get persistedState(): TopologyViewState {
        return this.viewState;
    }

    savePersistedState(patch: Partial<TopologyViewState>): void {
        Object.assign(this.viewState, patch);
        vscodeApi.setState(this.viewState);
    }

    // Nachrichten

    receive(message: ExtensionToWebviewMessage): void {
        if (message.type !== "state") {
            return;
        }
        const previousIds = new Set(this.model.devices.keys());
        this.model = toViewModel(message.topology);

        if (message.discardPendingChanges) {
            this.pendingPositions.clear();
        }
        // Bestätigte oder verschwundene optimistische Positionen verwerfen
        for (const [id, position] of this.pendingPositions) {
            const stored = this.model.devices.get(id)?.position;
            const isDragged = this.gesture?.kind === "device" && this.gesture.deviceId === id;
            if (!stored || (!isDragged && stored.x === position.x && stored.y === position.y)) {
                this.pendingPositions.delete(id);
            }
        }

        if (this.selectedId && !this.model.devices.has(this.selectedId)) {
            this.selectedId = undefined;
        }
        if (this.selectNextAddedDevice) {
            const added = [...this.model.devices.keys()].find((id) => !previousIds.has(id));
            if (added) {
                this.selectNextAddedDevice = false;
                this.select(added, true);
            }
        }

        this.nameLabel.textContent = this.model.name;
        this.renderer.sync(this.model, (id) => this.positionOf(id));
        this.renderer.setSelected(this.selectedId);
        this.renderInterfacePanel();
        this.emptyState.classList.toggle("visible", this.model.devices.size === 0);

        if (!this.hasReceivedState) {
            this.hasReceivedState = true;
            if (!isValidViewport(this.viewState.viewport)) {
                // Erste Anzeige ohne gespeicherte Ansicht: alles zeigen bzw. Ursprung zentrieren
                if (this.model.devices.size > 0) {
                    this.fitToContent();
                } else {
                    this.applyViewport(
                        centerOn(DEFAULT_VIEWPORT, { x: 0, y: 0 }, this.canvasSize.width, this.canvasSize.height),
                        true
                    );
                }
            }
        }

        this.notifyModelListeners();
    }

    // Auswahl & Aktionen

    private select(id: string | undefined, focus = false): void {
        this.selectedId = id;
        this.renderer.setSelected(id);
        if (id && focus) {
            this.renderer.focusDevice(id);
        }
    }

    private deleteSelected(): void {
        if (this.selectedId) {
            vscodeApi.postMessage({ type: "deleteDevice", deviceId: this.selectedId });
        }
    }

    private addDevice(type: DeviceType, position: Point): void {
        this.selectNextAddedDevice = true;
        vscodeApi.postMessage({ type: "addDevice", deviceType: type, position });
    }

    private commitMoves(moves: Map<string, Point>): void {
        if (moves.size === 0) {
            return;
        }
        vscodeApi.postMessage({
            type: "moveDevices",
            moves: [...moves].map(([deviceId, position]) => ({ deviceId, position })),
        });
    }

    private moveSelectedBy(dx: number, dy: number): void {
        const id = this.selectedId;
        if (!id) {
            return;
        }
        const current = this.positionOf(id);
        const next = { x: current.x + dx, y: current.y + dy };
        this.pendingPositions.set(id, next);
        this.renderer.setDevicePosition(id, next);
        this.notifyModelListeners();

        // Mehrere Tastendrücke werden zu einem Speichervorgang zusammengefasst.
        this.keyboardMoves.set(id, next);
        window.clearTimeout(this.keyboardMoveTimer);
        this.keyboardMoveTimer = window.setTimeout(() => {
            this.commitMoves(this.keyboardMoves);
            this.keyboardMoves.clear();
        }, KEYBOARD_MOVE_DEBOUNCE_MS);
    }

    private setPlacementType(type: DeviceType | undefined): void {
        if (type && this.cableMode) {
            this.setCableMode(false);
        }
        this.placementType = type;
        for (const [buttonType, button] of this.paletteButtons) {
            button.classList.toggle("active", buttonType === type);
            button.setAttribute("aria-pressed", String(buttonType === type));
        }
        this.canvas.classList.toggle("placing", type !== undefined);
        if (type) {
            this.showHint(`Klicke auf die Fläche, um einen ${DEVICE_TYPE_LABEL[type]} zu platzieren · Esc bricht ab`);
            if (this.lastPointerScreen) {
                this.renderer.showGhost(type, this.snappedWorld(this.lastPointerScreen, false));
            }
        } else {
            this.showHint(undefined);
            this.renderer.showGhost(undefined);
        }
    }

    private showHint(text: string | undefined): void {
        this.hint.textContent = text ?? "";
        this.hint.classList.toggle("visible", text !== undefined);
    }

    // Ansicht

    private applyViewport(viewport: Viewport, persist: boolean): void {
        this.viewport = viewport;
        this.renderer.setViewport(viewport);
        this.zoomLabel.textContent = `${Math.round(viewport.zoom * 100)} %`;
        for (const listener of this.viewportListeners) {
            listener(viewport);
        }
        if (persist) {
            window.clearTimeout(this.saveStateTimer);
            this.saveStateTimer = window.setTimeout(
                () => this.savePersistedState({ viewport: this.viewport }),
                STATE_SAVE_DEBOUNCE_MS
            );
        }
    }

    private zoomBy(factor: number, anchor?: Point): void {
        this.zoomTo(this.viewport.zoom * factor, anchor);
    }

    private zoomTo(zoom: number, anchor?: Point): void {
        const center = anchor ?? { x: this.canvasSize.width / 2, y: this.canvasSize.height / 2 };
        this.applyViewport(zoomAt(this.viewport, center, zoom), true);
    }

    fitToContent(): void {
        const bounds = boundsOfPoints([...this.model.devices.keys()].map((id) => this.positionOf(id)));
        if (!bounds) {
            this.applyViewport(
                centerOn(this.viewport, { x: 0, y: 0 }, this.canvasSize.width, this.canvasSize.height),
                true
            );
            return;
        }
        const withExtent = expandBounds(bounds, Math.max(DEVICE_EXTENT.left, DEVICE_EXTENT.bottom));
        this.applyViewport(
            fitBounds(withExtent, this.canvasSize.width, this.canvasSize.height, 32, 1),
            true
        );
    }

    private onResize(): void {
        const rect = this.canvas.getBoundingClientRect();
        this.canvasRect = rect;
        this.canvasSize = { width: rect.width, height: rect.height };
        for (const listener of this.viewportListeners) {
            listener(this.viewport);
        }
    }

    // Koordinaten

    private toScreen(event: { clientX: number; clientY: number }): Point {
        const rect = this.canvasRect ?? this.canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    private isOverCanvas(event: { clientX: number; clientY: number }): boolean {
        const rect = this.canvas.getBoundingClientRect();
        return containsPoint(
            { minX: rect.left, minY: rect.top, maxX: rect.right, maxY: rect.bottom },
            { x: event.clientX, y: event.clientY }
        );
    }

    private snappedWorld(screen: Point, free: boolean): Point {
        const world = screenToWorld(this.viewport, screen);
        return free ? { x: Math.round(world.x), y: Math.round(world.y) } : snapToGrid(world);
    }

    // Ereignisse

    private registerEvents(): void {
        const svg = this.renderer.svg;

        svg.addEventListener("pointerdown", (event) => this.onCanvasPointerDown(event));
        svg.addEventListener("pointermove", (event) => {
            this.lastPointerScreen = this.toScreen(event);
            if (!this.gesture && this.placementType) {
                this.renderer.showGhost(this.placementType, this.snappedWorld(this.lastPointerScreen, event.altKey));
            }
        });
        svg.addEventListener("pointerleave", () => {
            this.lastPointerScreen = undefined;
            if (!this.gesture) {
                this.renderer.showGhost(undefined);
            }
        });
        svg.addEventListener("dblclick", (event) => {
            const id = this.renderer.deviceIdAt(event.target);
            if (id) {
                vscodeApi.postMessage({ type: "openDevice", deviceId: id });
            }
        });
        svg.addEventListener("contextmenu", (event) => {
            const id = this.renderer.deviceIdAt(event.target);
            if (id) {
                this.select(id);
            }
        });
        svg.addEventListener("focusin", (event) => {
            const id = this.renderer.deviceIdAt(event.target);
            if (id && id !== this.selectedId) {
                this.select(id);
            }
        });
        svg.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });

        window.addEventListener("pointermove", (event) => this.onPointerMove(event));
        window.addEventListener("pointerup", (event) => this.onPointerUp(event));
        window.addEventListener("pointercancel", () => this.cancelGesture());
        window.addEventListener("keydown", (event) => this.onKeyDown(event));
        window.addEventListener("blur", () => this.cancelGesture());
    }

    private onCanvasPointerDown(event: PointerEvent): void {
        if (this.gesture) {
            return;
        }
        this.canvasRect = this.canvas.getBoundingClientRect();
        const screen = this.toScreen(event);

        // Mittlere Maustaste: immer Ansicht verschieben.
        if (event.button === 1) {
            event.preventDefault();
            this.gesture = { kind: "pan", pointerId: event.pointerId, lastScreen: screen, moved: false };
            return;
        }
        if (event.button !== 0) {
            return;
        }

        if (this.placementType) {
            this.addDevice(this.placementType, this.snappedWorld(screen, event.altKey));
            this.setPlacementType(undefined);
            return;
        }

        const deviceId = this.renderer.deviceIdAt(event.target);

        if (this.cableMode) {
            if (deviceId) {
                this.handleCableDeviceClick(
                    deviceId,
                    event.clientX,
                    event.clientY
                );
            } else {
                this.showHint("Klicke auf ein Gerät, um das Kabelende auszuwählen.");
            }
            return;
        }

        if (deviceId) {
            this.select(deviceId, true);
            const world = screenToWorld(this.viewport, screen);
            const position = this.positionOf(deviceId);
            this.gesture = {
                kind: "device",
                pointerId: event.pointerId,
                deviceId,
                startScreen: screen,
                grabOffset: { x: world.x - position.x, y: world.y - position.y },
                dragging: false,
            };
            return;
        }

        // Leere Fläche: Auswahl aufheben, Ziehen verschiebt die Ansicht.
        this.select(undefined);
        this.gesture = { kind: "pan", pointerId: event.pointerId, lastScreen: screen, moved: false };
    }

    private onPointerMove(event: PointerEvent): void {
        const gesture = this.gesture;
        if (!gesture || gesture.pointerId !== event.pointerId) {
            return;
        }

        switch (gesture.kind) {
            case "device": {
                const screen = this.toScreen(event);
                if (!gesture.dragging) {
                    const distance = Math.hypot(screen.x - gesture.startScreen.x, screen.y - gesture.startScreen.y);
                    if (distance < DRAG_THRESHOLD) {
                        return;
                    }
                    gesture.dragging = true;
                    this.renderer.setDragging(gesture.deviceId);
                    this.canvas.classList.add("moving");
                }
                const world = screenToWorld(this.viewport, screen);
                const raw = { x: world.x - gesture.grabOffset.x, y: world.y - gesture.grabOffset.y };
                const position = event.altKey
                    ? { x: Math.round(raw.x), y: Math.round(raw.y) }
                    : snapToGrid(raw);
                this.pendingPositions.set(gesture.deviceId, position);
                this.renderer.setDevicePosition(gesture.deviceId, position);
                this.notifyModelListeners();
                return;
            }
            case "pan": {
                const screen = this.toScreen(event);
                const dx = screen.x - gesture.lastScreen.x;
                const dy = screen.y - gesture.lastScreen.y;
                if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
                    return;
                }
                gesture.moved = true;
                gesture.lastScreen = screen;
                this.canvas.classList.add("panning");
                this.applyViewport(panBy(this.viewport, dx, dy), true);
                return;
            }
            case "palette": {
                if (!gesture.dragging) {
                    const distance = Math.hypot(
                        event.clientX - gesture.startClient.x,
                        event.clientY - gesture.startClient.y
                    );
                    if (distance < DRAG_THRESHOLD) {
                        return;
                    }
                    gesture.dragging = true;
                    this.setPlacementType(undefined);
                    document.body.classList.add("dragging-new");
                }
                if (this.isOverCanvas(event)) {
                    this.canvasRect = this.canvas.getBoundingClientRect();
                    const position = this.snappedWorld(this.toScreen(event), event.altKey);
                    this.renderer.showGhost(gesture.deviceType, position);
                } else {
                    this.renderer.showGhost(undefined);
                }
                return;
            }
        }
    }

    private onPointerUp(event: PointerEvent): void {
        const gesture = this.gesture;
        if (!gesture || gesture.pointerId !== event.pointerId) {
            return;
        }
        this.gesture = undefined;

        switch (gesture.kind) {
            case "device":
                this.renderer.setDragging(undefined);
                this.canvas.classList.remove("moving");
                if (gesture.dragging) {
                    const position = this.pendingPositions.get(gesture.deviceId);
                    if (position) {
                        this.commitMoves(new Map([[gesture.deviceId, position]]));
                    }
                }
                return;
            case "pan":
                this.canvas.classList.remove("panning");
                return;
            case "palette":
                document.body.classList.remove("dragging-new");
                this.renderer.showGhost(undefined);
                if (!gesture.dragging) {
                    // Klick ohne Ziehen: Platzierungsmodus ein/aus.
                    this.setPlacementType(this.placementType === gesture.deviceType ? undefined : gesture.deviceType);
                    return;
                }
                if (this.isOverCanvas(event)) {
                    this.canvasRect = this.canvas.getBoundingClientRect();
                    this.addDevice(gesture.deviceType, this.snappedWorld(this.toScreen(event), event.altKey));
                }
                return;
        }
    }

    /** Abbruch (Esc, Fokusverlust): laufendes Ziehen rückgängig machen, nichts speichern. */
    private cancelGesture(): void {
        const gesture = this.gesture;
        this.gesture = undefined;
        if (!gesture) {
            return;
        }
        if (gesture.kind === "device" && gesture.dragging) {
            this.pendingPositions.delete(gesture.deviceId);
            this.renderer.setDragging(undefined);
            this.renderer.setDevicePosition(gesture.deviceId, this.positionOf(gesture.deviceId));
            this.notifyModelListeners();
        }
        this.canvas.classList.remove("moving", "panning");
        document.body.classList.remove("dragging-new");
        this.renderer.showGhost(undefined);
    }

    private onWheel(event: WheelEvent): void {
        event.preventDefault();
        this.canvasRect = this.canvas.getBoundingClientRect();
        // Strg+Mausrad und Touchpad-Pinch (Chromium meldet Pinch als ctrlKey) zoomen zum Cursor.
        if (event.ctrlKey || event.metaKey) {
            const factor = Math.exp(-event.deltaY * 0.0015 * (event.deltaMode === 1 ? 20 : 1));
            this.zoomBy(factor, this.toScreen(event));
            return;
        }
        const scale = event.deltaMode === 1 ? 20 : 1;
        let dx = event.deltaX * scale;
        let dy = event.deltaY * scale;
        if (event.shiftKey && dx === 0) {
            dx = dy;
            dy = 0;
        }
        this.applyViewport(panBy(this.viewport, -dx, -dy), true);
    }

    private onKeyDown(event: KeyboardEvent): void {
        if (
            event.key !== "Escape" &&
            (
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLTextAreaElement ||
                event.target instanceof HTMLSelectElement ||
                event.target instanceof HTMLButtonElement
            )
        ) {
            return;
        }
        const step = event.shiftKey ? GRID_SIZE * 5 : GRID_SIZE;

        switch (event.key) {
            case "Escape":
                if (this.cableMode) {
                    this.setCableMode(false);
                } else if (this.gesture) {
                    this.cancelGesture();
                } else if (this.placementType) {
                    this.setPlacementType(undefined);
                } else {
                    this.select(undefined);
                }
                break;
            case "Delete":
            case "Backspace":
                this.deleteSelected();
                break;
            case "F2":
                if (this.selectedId) {
                    vscodeApi.postMessage({ type: "renameDevice", deviceId: this.selectedId });
                }
                break;
            case "Enter":
                if (this.selectedId) {
                    vscodeApi.postMessage({ type: "openDevice", deviceId: this.selectedId });
                }
                break;
            case "ArrowLeft":
                this.moveSelectedBy(-step, 0);
                break;
            case "ArrowRight":
                this.moveSelectedBy(step, 0);
                break;
            case "ArrowUp":
                this.moveSelectedBy(0, -step);
                break;
            case "ArrowDown":
                this.moveSelectedBy(0, step);
                break;
            case "+":
            case "=":
                this.zoomBy(ZOOM_STEP);
                break;
            case "-":
                this.zoomBy(1 / ZOOM_STEP);
                break;
            case "0":
                this.fitToContent();
                break;
            case "1":
                this.zoomTo(1);
                break;
            default:
                return;
        }
        event.preventDefault();
    }

    private setCableMode(active: boolean): void {
        this.hideInterfacePopup();
        this.cableMode = active;
        this.cableFirstDeviceId = undefined;
        this.cableFirstInterfaceId = undefined;
        this.cableSecondDeviceId = undefined;
        this.cableSecondInterfaceId = undefined;

        this.interfaceASelect.value = "";
        this.interfaceBSelect.value = "";

        this.cableButton.classList.toggle("active", active);
        this.cableButton.setAttribute("aria-pressed", String(active));

        if (active) {
            this.setPlacementType(undefined);
            this.showHint("Klicke auf das erste Gerät · Esc bricht ab");
        } else {
            this.showHint(undefined);
        }

        this.renderInterfacePanel();
    }

        
    private handleCableDeviceClick(
        deviceId: string,
        clientX: number,
        clientY: number
    ): void {
        if (!this.cableFirstDeviceId) {
            this.cableFirstDeviceId = deviceId;
            this.select(deviceId, true);

            this.showInterfacePopup(
                deviceId,
                clientX,
                clientY,
                "first"
            );
            return;
        }

        if (!this.cableFirstInterfaceId) {
            this.showHint("Wähle zuerst ein Interface des ersten Geräts.");
            return;
        }

        if (deviceId === this.cableFirstDeviceId) {
            this.showHint("Wähle ein anderes Gerät für das zweite Kabelende.");
            return;
        }

        this.cableSecondDeviceId = deviceId;
        this.cableSecondInterfaceId = undefined;

        this.select(deviceId, true);

        this.showInterfacePopup(
            deviceId,
            clientX,
            clientY,
            "second"
        );
    }

    private showInterfacePopup(
        deviceId: string,
        clientX: number,
        clientY: number,
        endpoint: "first" | "second"
    ): void {
        const device = this.model.devices.get(deviceId);

        if (!device) {
            return;
        }

        const occupied = new Set(
            this.model.connections.flatMap((connection) => [
                connection.interfaceAId,
                connection.interfaceBId,
            ])
        );

        this.interfacePopup.replaceChildren();

        const title = htmlElement(
            "h3",
            "interface-popup-title",
            `${device.hostname} · Interface auswählen`
        );

        this.interfacePopup.append(title);

        const freeInterfaces = device.interfaces.filter(
            (iface) => !occupied.has(iface.id)
        );

        for (const iface of device.interfaces) {
            const isOccupied = occupied.has(iface.id);

            const button = htmlElement(
                "button",
                `interface-popup-option${isOccupied ? " occupied" : ""}`,
                `${iface.name}${isOccupied ? " · Belegt" : ""}`
            );

            button.type = "button";
            button.disabled = isOccupied;

            if (!isOccupied) {
                button.addEventListener("click", () => {
                    if (endpoint === "first") {
                        this.cableFirstInterfaceId = iface.id;
                        this.interfaceASelect.value = iface.id;

                        this.interfacePopup.hidden = true;
                        this.showHint(
                            "Klicke auf das zweite Gerät."
                        );
                        return;
                    }

                    this.cableSecondInterfaceId = iface.id;
                    this.interfaceBSelect.value = iface.id;

                    if (
                        !this.cableFirstInterfaceId ||
                        !this.cableFirstDeviceId ||
                        !this.cableSecondDeviceId
                    ) {
                        this.showHint("Bitte wähle beide Kabelenden aus.");
                        return;
                    }

                    vscodeApi.postMessage({
                        type: "addConnection",
                        interfaceAId: this.cableFirstInterfaceId,
                        interfaceBId: this.cableSecondInterfaceId,
                    });

                    this.setCableMode(false);
                });
            }

            this.interfacePopup.append(button);
        }

        if (freeInterfaces.length === 0) {
            this.interfacePopup.append(
                htmlElement(
                    "p",
                    "interface-popup-empty",
                    "Keine freien Interfaces verfügbar."
                )
            );
        }

        const canvasRect = this.canvas.getBoundingClientRect();

        this.interfacePopup.hidden = false;

        // Zuerst nahe am angeklickten Gerät positionieren.
        this.interfacePopup.style.left =
            `${clientX - canvasRect.left + 16}px`;
        this.interfacePopup.style.top =
            `${clientY - canvasRect.top + 8}px`;

        // Danach sicherstellen, dass das Popup im sichtbaren Canvas bleibt.
        const popupRect = this.interfacePopup.getBoundingClientRect();

        const left = Math.max(
            8,
            Math.min(
                clientX - canvasRect.left + 16,
                this.canvas.clientWidth - popupRect.width - 8
            )
        );

        const top = Math.max(
            8,
            Math.min(
                clientY - canvasRect.top + 8,
                this.canvas.clientHeight - popupRect.height - 8
            )
        );

        this.interfacePopup.style.left = `${left}px`;
        this.interfacePopup.style.top = `${top}px`;
    }

    private hideInterfacePopup(): void {
        this.interfacePopup.hidden = true;
        this.interfacePopup.replaceChildren();
    }



    private renderInterfacePanel(): void {
        const occupied = new Set(
            this.model.connections.flatMap((connection) => [
                connection.interfaceAId,
                connection.interfaceBId,
            ])
        );

        const updateSelect = (
            select: HTMLSelectElement,
            deviceId: string | undefined,
            selectedInterfaceId: string | undefined,
            placeholderText: string
        ): void => {
            select.replaceChildren();
            select.disabled = !this.cableMode || !deviceId;

            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = placeholderText;
            select.append(placeholder);

            const device = deviceId
                ? this.model.devices.get(deviceId)
                : undefined;

            for (const iface of device?.interfaces ?? []) {
                const isOccupied = occupied.has(iface.id);
                const option = document.createElement("option");

                option.value = iface.id;
                option.textContent =
                    `${iface.name}${isOccupied ? " (belegt)" : ""}`;
                option.disabled = isOccupied;

                select.append(option);
            }

            if (
                selectedInterfaceId &&
                device?.interfaces.some(
                    (iface) =>
                        iface.id === selectedInterfaceId &&
                        !occupied.has(iface.id)
                )
            ) {
                select.value = selectedInterfaceId;
            }
        };

        updateSelect(
            this.interfaceASelect,
            this.cableFirstDeviceId,
            this.cableFirstInterfaceId,
            this.cableFirstDeviceId
                ? "Erstes Interface auswählen"
                : "Erstes Gerät anklicken"
        );

        updateSelect(
            this.interfaceBSelect,
            this.cableSecondDeviceId,
            this.cableSecondInterfaceId,
            this.cableSecondDeviceId
                ? "Zweites Interface auswählen"
                : "Zweites Gerät anklicken"
        );

        this.connectButton.disabled = !(
            this.cableMode &&
            this.cableFirstInterfaceId &&
            this.cableSecondInterfaceId
        );

        this.connectionList.replaceChildren();

        if (this.model.connections.length === 0) {
            this.connectionList.append(
                htmlElement("p", "interface-empty", "Noch keine Verbindungen.")
            );
        }

        for (const connection of this.model.connections) {
            const deviceA = this.model.devices.get(connection.deviceA);
            const deviceB = this.model.devices.get(connection.deviceB);
            if (!deviceA || !deviceB) {
                continue;
            }

            const item = htmlElement("div", "connection-item");
            const description = htmlElement(
                "div",
                "connection-description",
                `${deviceA.hostname} · ${connection.interfaceAName} ↔ ${deviceB.hostname} · ${connection.interfaceBName}`
            );

            const removeButton = htmlElement("button", "interface-remove", "Trennen");
            removeButton.type = "button";
            removeButton.addEventListener("click", () => {
                vscodeApi.postMessage({
                    type: "removeConnection",
                    connectionId: connection.id,
                });
            });

            item.append(description, removeButton);
            this.connectionList.append(item);
        }

       
        // Portübersicht aller Geräte
        this.interfaceOverview.replaceChildren();

        const overviewTitle = htmlElement(
            "h3",
            "interface-section-title",
            "Portbelegung"
        );

        this.interfaceOverview.append(overviewTitle);
        for (const device of this.model.devices.values()) {
            const group = htmlElement("section", "interface-device");
            group.append(
                htmlElement("h4", "interface-device-title", device.hostname)
            );

            for (const iface of device.interfaces) {
                const isOccupied = occupied.has(iface.id);
                const row = htmlElement("div", "interface-row");

                row.append(
                    htmlElement("span", "interface-name", iface.name),
                    htmlElement(
                        "span",
                        `interface-status ${isOccupied ? "occupied" : "free"}`,
                        isOccupied ? "Belegt" : "Frei"
                    )
                );

                group.append(row);
            }

            if (device.interfaces.length === 0) {
                group.append(
                    htmlElement("p", "interface-empty", "Keine Interfaces vorhanden.")
                );
            }

            this.interfaceOverview.append(group);
        }
    }

    // Bausteine

    private createPaletteButton(type: DeviceType): HTMLButtonElement {
        const label = DEVICE_TYPE_LABEL[type];
        const button = htmlElement("button", "palette-item");
        button.type = "button";
        button.dataset.deviceType = type;
        button.title = `${label} – auf die Fläche ziehen oder anklicken und dann platzieren`;
        button.setAttribute("aria-pressed", "false");

        const icon = svgElement("svg", { class: "palette-icon", viewBox: "0 0 48 48", "aria-hidden": "true" });
        icon.append(svgElement("use", { href: iconHref(type) }));
        button.append(icon, htmlElement("span", "palette-label", label));

        button.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || this.gesture) {
                return;
            }
            event.preventDefault();
            this.gesture = {
                kind: "palette",
                pointerId: event.pointerId,
                deviceType: type,
                startClient: { x: event.clientX, y: event.clientY },
                dragging: false,
            };
        });
        // Tastaturbedienung: Enter/Leertaste fügt das Gerät in der Mitte der Ansicht ein.
        button.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                const center = { x: this.canvasSize.width / 2, y: this.canvasSize.height / 2 };
                this.addDevice(type, this.snappedWorld(center, false));
            }
        });
        return button;
    }

    private createToolButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
        const button = htmlElement("button", "tool-button", text);
        button.type = "button";
        button.title = title;
        button.setAttribute("aria-label", title);
        button.addEventListener("click", onClick);
        return button;
    }
}
