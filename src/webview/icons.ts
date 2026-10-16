/**
 * Eigene Geräte-Icons als SVG-Symbole: (Vektorgrafik bleibt beim Zoomen scharf,
 * keine fremden Bildrechte)
 */

import type { DeviceType } from "../modules/topology/models";
import { SVG_NS } from "./svg";

export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
    router: "Router",
    switch: "Switch",
    pc: "PC",
};

export const DEVICE_TYPE_COLOR: Record<DeviceType, string> = {
    router: "#13838c",
    switch: "#3d6fb0",
    pc: "#7d8b99",
};

export const ICON_SIZE = 48;

const SYMBOLS = `
<symbol id="icon-router" viewBox="0 0 48 48">
  <path d="M4 18v12c0 4.4 9 8 20 8s20-3.6 20-8V18" fill="#0f6f77"/>
  <ellipse cx="24" cy="18" rx="20" ry="8" fill="#19a3ad"/>
  <g stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M12 14.5l7 2.5M12 14.5l2.6-.4M12 14.5l1.4 2"/>
    <path d="M36 21.5l-7-2.5M36 21.5l-2.6.4M36 21.5l-1.4-2"/>
    <path d="M26 13.5l7-2M33 11.5l-2.4-1M33 11.5l-1.6 1.9"/>
    <path d="M22 22.5l-7 2M15 24.5l2.4 1M15 24.5l1.6-1.9"/>
  </g>
</symbol>
<symbol id="icon-switch" viewBox="0 0 48 48">
  <path d="M8 8h28l4 4v28H12l-4-4z" fill="#2c548a"/>
  <rect x="6" y="6" width="32" height="32" rx="2" fill="#3d6fb0"/>
  <g stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M22 10v24M10 22h24"/>
    <path d="M19 13l3-3 3 3M19 31l3 3 3-3M13 19l-3 3 3 3M31 19l3 3-3 3"/>
  </g>
  <circle cx="22" cy="22" r="3.4" fill="#ff4d6d"/>
</symbol>
<symbol id="icon-pc" viewBox="0 0 48 48">
  <rect x="7" y="6" width="34" height="25" rx="2.5" fill="#c9d1d9"/>
  <rect x="10" y="9" width="28" height="19" rx="1" fill="#4a5866"/>
  <path d="M20 31h8l1.5 6h-11z" fill="#aeb8c2"/>
  <path d="M11 37h26l3 5H8z" fill="#c9d1d9"/>
  <path d="M13 13h10" stroke="#9fb3c6" stroke-width="2" stroke-linecap="round"/>
</symbol>`;

/** Fügt die Symbole einmalig als unsichtbares SVG-"Sprite" ins Dokument ein. */
export function installIconSprite(): void {
    const sprite = document.createElementNS(SVG_NS, "svg");
    sprite.setAttribute("aria-hidden", "true");
    sprite.setAttribute("class", "icon-sprite");
    sprite.innerHTML = SYMBOLS;
    document.body.prepend(sprite);
}

export function iconHref(type: DeviceType): string {
    return `#icon-${type}`;
}
