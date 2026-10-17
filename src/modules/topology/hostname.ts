/**
 * Regeln für Hostnamen
 */

import type { DeviceType } from "./models";

export const HOSTNAME_PREFIX: Record<DeviceType, string> = {
    router: "R",
    switch: "SW",
    pc: "PC",
};

/** Cisco IOS akzeptiert Hostnamen bis 63 Zeichen */
export const MAX_HOSTNAME_LENGTH = 63;

/**
 * Beginnt mit einem Buchstaben, enthält nur Buchstaben, Ziffern und Bindestriche
 * und endet nicht mit einem Bindestrich.
 */
const HOSTNAME_PATTERN = /^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

export function validateHostname(hostname: string): string | undefined {
    if (hostname.length === 0) {
        return "Der Hostname darf nicht leer sein.";
    }
    if (hostname.length > MAX_HOSTNAME_LENGTH) {
        return "Der Hostname darf höchstens ${MAX_HOSTNAME_LENGTH} Zeichen lang sein.";
    }
    if (!HOSTNAME_PATTERN.test(hostname)) {
        return "Der Hostname muss mit einem Buchstaben beginnen und darf nur Buchstaben, Ziffern und Bindestriche enthalten (nicht am Ende).";
    }
    return undefined;
}

/** Hostnamen werden ohne Beachtung der Groß-/Kleinschreibung verglichen (wie DNS). */
export function isHostnameTaken(
    hostname: string,
    existingHostnames: Iterable<string>
): boolean {
    const wanted = hostname.toLowerCase();
    for (const existing of existingHostnames) {
        if (existing.toLowerCase() === wanted) {
            return true;
        }
    }
    return false;
}

/**
 * Nächster automatischer Hostname für einen Gerätetyp: höchste vorhandene Nummer + 1
 * (R1, R2, …). Nummern gelöschter Geräte werden bewusst NICHT wiederverwendet, damit
 * ein neues Gerät nicht mit alten Konfigurationsdateien/Notizen verwechselt wird.
 */
export function nextHostname(type: DeviceType, existingHostnames: Iterable<string>): string {
    const prefix = HOSTNAME_PREFIX[type];
    const pattern = new RegExp(`^${prefix}(\\d+)$`, "i");

    let highest = 0;
    for (const hostname of existingHostnames) {
        const match = pattern.exec(hostname);
        if (match) {
            highest = Math.max(highest, Number(match[1]));
        }
    }
    return `${prefix}${highest + 1}`;
}
