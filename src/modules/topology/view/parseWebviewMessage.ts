/**
 * Prüft Nachrichten aus der Webview, bevor sie den Store erreichen.
 *
 * Die Webview ist eine Vertrauensgrenze: Inhalte kommen aus einem Browser-Kontext und
 * werden deshalb wie Benutzereingaben behandelt (Typ, IDs, Zahlen, Mengen).
 */

import { isFinitePoint } from "../../../shared/geometry";
import {
    DEVICE_TYPES,
    DeviceMoveMessage,
    WebviewToExtensionMessage,
} from "../../../shared/protocol";
import type { DeviceType } from "../models";
import { isDeviceConfiguration } from "../../../shared/deviceConfiguration";

const MAX_ID_LENGTH = 128;
const MAX_MOVES_PER_MESSAGE = 1000;

function isId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isDeviceType(value: unknown): value is DeviceType {
    return typeof value === "string" && (DEVICE_TYPES as readonly string[]).includes(value);
}

function isMove(value: unknown): value is DeviceMoveMessage {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const move = value as Record<string, unknown>;
    return isId(move.deviceId) && isFinitePoint(move.position);
}

/** Gibt die geprüfte Nachricht zurück oder "undefined", wenn sie ungültig ist. */
export function parseWebviewMessage(raw: unknown): WebviewToExtensionMessage | undefined {
    if (typeof raw !== "object" || raw === null) {
        return undefined;
    }
    const message = raw as Record<string, unknown>;

    switch (message.type) {
        case "configureDevice":
            if (isId(message.deviceId) && isDeviceConfiguration(message.configuration)) {
                return { type: "configureDevice", deviceId: message.deviceId,
                    configuration: message.configuration };
            }
            return undefined;
        case "ready":
            return { type: "ready" };

        case "addDevice":
            if (isDeviceType(message.deviceType) && isFinitePoint(message.position)) {
                return {
                    type: "addDevice",
                    deviceType: message.deviceType,
                    position: { x: message.position.x, y: message.position.y },
                };
            }
            return undefined;

        case "moveDevices":
            if (
                Array.isArray(message.moves) &&
                message.moves.length > 0 &&
                message.moves.length <= MAX_MOVES_PER_MESSAGE &&
                message.moves.every(isMove)
            ) {
                return {
                    type: "moveDevices",
                    moves: message.moves.map((move: DeviceMoveMessage) => ({
                        deviceId: move.deviceId,
                        position: { x: move.position.x, y: move.position.y },
                    })),
                };
            }
            return undefined;

        case "deleteDevice":
        case "renameDevice":
        case "openDevice":
            if (isId(message.deviceId)) {
                return { type: message.type, deviceId: message.deviceId };
            }
            return undefined;

        
        case "addConnection":
            if (
                isId(message.interfaceAId) &&
                isId(message.interfaceBId)
            ) {
                return {
                    type: "addConnection",
                    interfaceAId: message.interfaceAId,
                    interfaceBId: message.interfaceBId,
                };
            }
            return undefined;

        case "removeConnection":
            if (isId(message.connectionId)) {
                return {
                    type: "removeConnection",
                    connectionId: message.connectionId,
                };
            }
            return undefined;

        default:
            return undefined;
    }
}
