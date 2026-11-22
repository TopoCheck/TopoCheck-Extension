/**
 * H3b: Regeln für die Switching-Protokolleingaben, gemeinsam genutzt von
 * Formular (Webview), Validierung und Store, damit alle dasselbe als "ausgefüllt" werten.
 */

import { ProtocolType } from "../models/protocolType";
import type { ProtocolSettings } from "../modules/topology/models";

/** VLAN 1 ist Default, 1002–1005 sind Cisco-reserviert, 999 nutzt der Generator für ungenutzte Ports. */
export const RESERVED_VLAN_IDS: readonly number[] = [1, 999, 1002, 1003, 1004, 1005];
export const DEFAULT_NATIVE_VLAN = 99;
/** IOS: max. 32 Zeichen; Leerzeichen würden in Packet Tracer Anführungszeichen erfordern. */
export const VLAN_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export function defaultSettings(type: ProtocolType): ProtocolSettings | undefined {
    switch (type) {
        case ProtocolType.Vlan: return { vlans: [], nativeVlan: DEFAULT_NATIVE_VLAN };
        case ProtocolType.Stp:
        case ProtocolType.Rstp: return { rootRole: "auto" };
        case ProtocolType.EtherChannel: return { lacpMode: "active" };
        default: return undefined;
    }
}

/** Ein Protokoll gilt erst als aktiviert, wenn alle Pflichtangaben vorhanden sind. */
export function isProtocolComplete(type: ProtocolType, settings: ProtocolSettings | undefined): boolean {
    switch (type) {
        case ProtocolType.Vlan:
            return (settings?.vlans?.length ?? 0) > 0 && settings!.vlans!.every((vlan) => vlan.name.trim() !== "") &&
                settings?.nativeVlan !== undefined;
        case ProtocolType.Stp:
        case ProtocolType.Rstp:
            return settings?.rootRole !== undefined;
        case ProtocolType.EtherChannel:
            return settings?.lacpMode !== undefined;
        default:
            return true;
    }
}
