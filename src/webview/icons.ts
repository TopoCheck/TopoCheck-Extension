/**
 * Geräte-Icons als SVG-Symbole
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

export const ICON_SIZE = 56;

const SYMBOLS = `
<defs>
<!-- router -->
    <linearGradient id="rsTop" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#26b3a1"/>
      <stop offset="1" stop-color="#0b7a70"/>
    </linearGradient>
    <linearGradient id="rsSide" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#063a36"/>
      <stop offset="0.45" stop-color="#0c6259"/>
      <stop offset="1" stop-color="#052e2b"/>
    </linearGradient>
    <radialGradient id="rsShadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#000" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <filter id="rsGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="1.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
<!-- switch -->
    <linearGradient id="swTop" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#26b3a1"/>
      <stop offset="1" stop-color="#0b7a70"/>
    </linearGradient>
    <linearGradient id="swSide" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#063a36"/>
      <stop offset="0.45" stop-color="#0c6259"/>
      <stop offset="1" stop-color="#052e2b"/>
    </linearGradient>
    <radialGradient id="swShadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#000" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <filter id="swGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
<!-- pc -->
    <linearGradient id="pcBezel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#26b3a1"/>
      <stop offset="1" stop-color="#0b7a70"/>
    </linearGradient>
    <linearGradient id="pcScreen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a4a45"/>
      <stop offset="1" stop-color="#03201e"/>
    </linearGradient>
    <linearGradient id="pcStand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#063a36"/>
      <stop offset="0.45" stop-color="#0c6259"/>
      <stop offset="1" stop-color="#052e2b"/>
    </linearGradient>
    <radialGradient id="pcShadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#000" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <filter id="pcGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
</defs>
<symbol id="icon-router" viewBox="0 0 64 64">
  <!-- Schatten -->
  <ellipse cx="32" cy="49" rx="26" ry="6" fill="url(#rsShadow)"/>

  <!-- Gehäuse -->
  <path d="M8 26 v12 a24 10 0 0 0 48 0 v-12 z" fill="url(#rsSide)"/>
  <ellipse cx="32" cy="26" rx="24" ry="10" fill="url(#rsTop)"/>
  <ellipse cx="32" cy="26" rx="24" ry="10" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.8"/>

  <!-- Status-LEDs -->
  <g filter="url(#rsGlow)">
    <circle cx="27" cy="41.5" r="1.3" fill="#4ade80"/>
    <circle cx="32" cy="42" r="1.3" fill="#4ade80"/>
    <circle cx="37" cy="41.5" r="1.3" fill="#38bdf8"/>
  </g>

  <!-- Routing-Pfeile -->
  <g transform="translate(32 26) scale(1 0.42)" fill="none" stroke="#ffffff"
     stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke">
    <path d="M5 -5 L15 -15 M9 -15 H15 V-9" vector-effect="non-scaling-stroke"/>
    <path d="M-5 5 L-15 15 M-9 15 H-15 V9" vector-effect="non-scaling-stroke"/>
    <path d="M-16 -16 L-6 -6 M-12 -6 H-6 V-12" vector-effect="non-scaling-stroke"/>
    <path d="M16 16 L6 6 M12 6 H6 V12" vector-effect="non-scaling-stroke"/>
  </g>
</symbol>
<symbol id="icon-switch" viewBox="0 0 64 64">
  <!-- Schatten -->
  <ellipse cx="32" cy="49" rx="26" ry="6" fill="url(#swShadow)"/>

  <!-- Gehäuse (liegend, gleiche Perspektive wie der Router) -->
  <rect x="8" y="26" width="48" height="22" rx="6" ry="3" fill="url(#swSide)"/>
  <rect x="8" y="16" width="48" height="20" rx="6" ry="3" fill="url(#swTop)"/>
  <rect x="8" y="16" width="48" height="20" rx="6" ry="3" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.8"/>

  <!-- LAN-Ports -->
  <g fill="#03201e" stroke="#26b3a1" stroke-opacity="0.5" stroke-width="0.5">
    <rect x="15" y="39.5" width="4" height="4" rx="0.5"/>
    <rect x="21" y="39.5" width="4" height="4" rx="0.5"/>
    <rect x="27" y="39.5" width="4" height="4" rx="0.5"/>
    <rect x="33" y="39.5" width="4" height="4" rx="0.5"/>
  </g>

  <!-- Status-LEDs -->
  <g filter="url(#swGlow)">
    <circle cx="45" cy="41.5" r="1.3" fill="#4ade80"/>
    <circle cx="50" cy="41.5" r="1.3" fill="#38bdf8"/>
  </g>

  <!-- Switching-Pfeile (perspektivisch flach) -->
  <g transform="translate(32 26) scale(1 0.42)" fill="none" stroke="#ffffff"
     stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-15 -10 H14 M9 -16 L14 -10 L9 -4" vector-effect="non-scaling-stroke"/>
    <path d="M15 10 H-14 M-9 4 L-14 10 L-9 16" vector-effect="non-scaling-stroke"/>
  </g>
</symbol>
<symbol id="icon-pc" viewBox="0 0 64 64">
  <!-- Schatten -->
  <ellipse cx="32" cy="52" rx="20" ry="4" fill="url(#pcShadow)"/>

  <!-- Standfuß -->
  <path d="M28 42 H36 L38 49 H26 Z" fill="url(#pcStand)"/>
  <ellipse cx="32" cy="50" rx="12" ry="2.6" fill="url(#pcBezel)"/>

  <!-- Monitor -->
  <rect x="8" y="10" width="48" height="33" rx="4" fill="url(#pcBezel)"/>
  <rect x="8" y="10" width="48" height="33" rx="4" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.8"/>
  <rect x="11.5" y="13.5" width="41" height="24" rx="2" fill="url(#pcScreen)"/>

  <!-- Bildschirm-Spiegelung -->
  <polygon points="11.5,13.5 30,13.5 18,37.5 11.5,37.5" fill="#ffffff" opacity="0.06"/>

  <!-- Terminal-Prompt -->
  <g fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 20 L21 23 L17 26"/>
    <path d="M24 26 H30"/>
  </g>

  <!-- Power-LED -->
  <circle cx="51" cy="40.3" r="1.1" fill="#4ade80" filter="url(#pcGlow)"/>
</symbol>`;

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
