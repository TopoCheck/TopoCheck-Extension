/**
 * Nachrichtenprotokoll zwischen Extension und Topologieansicht (Webview).
 * Grundprinzip:
 *  - Die Webview schickt nur Absichten ("füge Router hier ein").
 *  - Die Extension ist die einzige Quelle der Wahrheit (TopologyStore) und schickt
 *    nach jeder Änderung den kompletten Zustand zurück.
 */

import type { DeviceType, Topology } from "../modules/topology/models";
import type { Point } from "./geometry";
import type { Viewport } from "./viewport.ts";
import type { DeviceConfiguration } from "./deviceConfiguration";
import type { Device } from "../modules/topology/models";
import type { ConfigurationFieldError } from "./validateDeviceConfiguration";

export const TOPOLOGY_VIEW_TYPE = "topocheck.topologyView";

export const DEVICE_TYPES: readonly DeviceType[] = ["router", "switch", "pc"];

export interface DeviceMoveMessage {
    deviceId: string;
    position: Point;
}


/** Webview -> Extension */
export type WebviewToExtensionMessage =
    | { type: "ready" }
    | { type: "addDevice"; deviceType: DeviceType; position: Point }
    | { type: "moveDevices"; moves: DeviceMoveMessage[] }
    | { type: "deleteDevice"; deviceId: string }
    | { type: "renameDevice"; deviceId: string }
    | { type: "openDevice"; deviceId: string }
    | { type: "configureDevice"; deviceId: string; configuration: DeviceConfiguration }
    | {
          type: "addConnection";
          interfaceAId: string;
          interfaceBId: string;
      }
    | { type: "removeConnection"; connectionId: string };


/** Extension -> Webview */
export type ExtensionToWebviewMessage = {
    type: "state";
    topology: Topology;
    discardPendingChanges?: boolean;
} | { type: "editDevice"; device: Device; otherHostnames: string[]; connectedInterfaceIds?: string[] }
  | { type: "configurationResult"; deviceId: string; error?: string; validationErrors?: ConfigurationFieldError[] };

/**
 * Zustand, den VS Code für die Webview aufbewahrt (getState/setState).
 */
export interface TopologyViewState {
    topologyId: string;
    viewport?: Viewport;
    minimapCollapsed?: boolean;
}
