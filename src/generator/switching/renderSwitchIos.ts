/**
 * Automatische Switching-Konfiguration: Ausgabestufe
 * Erzeugt aus dem Soll-Modell eines Switches Cisco-IOS-Konfigurationstext
 */

import { formatIosSection, joinIosBlocks } from "../iosSections";
import type { SwitchportConfiguration } from "../../models/ciscoProtocols";
import type { PortChannelPlan, PortPlan, SwitchPlan } from "./types";

export function renderSwitchIos(plan: SwitchPlan): string {
    const vlans = plan.vlans.map((vlan) => [
        `vlan ${vlan.vlanId}`,
        ...(vlan.name ? [` name ${vlan.name}`] : []),
        " exit"
    ].join("\n"));
    const spanningTree = [`spanning-tree mode ${plan.stp.mode}`];
    if (plan.stp.priority !== undefined) {
        spanningTree.push(
            `! ${plan.stp.rootRole === "primary" ? "Primary" : "Secondary"} Root Bridge`,
            `spanning-tree vlan ${formatVlanList(plan.stp.vlans)} priority ${plan.stp.priority}`
        );
    }

    return joinIosBlocks([
        formatIosSection("Grundkonfiguration", [`hostname ${plan.hostname}`]),
        formatIosSection("VLANs", vlans),
        formatIosSection("Spanning Tree", [spanningTree.join("\n")]),
        formatIosSection("Interfaces", plan.ports.map((port) => renderPort(port).join("\n"))),
        formatIosSection("EtherChannel", plan.portChannels.map((channel) => renderPortChannel(channel).join("\n"))),
        "end"
    ]) + "\n";
}

function renderPort(port: PortPlan): string[] {
    const lines = [`interface ${port.name}`];
    if (port.description) {
        lines.push(` description ${port.description}`);
    }
    lines.push(...renderSwitchport(port.switchport, port.nonegotiate));
    if (port.channelGroup !== undefined) {
        lines.push(` channel-group ${port.channelGroup} mode ${port.channelMode ?? "active"}`);
    }
    if (port.portfast) {
        lines.push(" spanning-tree portfast");
    }
    if (port.bpduGuard) {
        lines.push(" spanning-tree bpduguard enable");
    }
    lines.push(port.shutdown ? " shutdown" : " no shutdown");
    lines.push(" exit");
    return lines;
}

function renderPortChannel(channel: PortChannelPlan): string[] {
    return [
        `interface Port-channel${channel.number}`,
        ` description EtherChannel (LACP) to ${channel.peerHostname}`,
        ...renderSwitchport(channel.switchport, channel.nonegotiate),
        " exit"
    ];
}

function renderSwitchport(switchport: SwitchportConfiguration | undefined, nonegotiate: boolean): string[] {
    if (!switchport?.mode) {
        return [];
    }
    const lines = [` switchport mode ${switchport.mode}`];
    if (switchport.mode === "access" && switchport.accessVlan !== undefined) {
        lines.push(` switchport access vlan ${switchport.accessVlan}`);
    }
    if (switchport.mode === "trunk") {
        if (switchport.nativeVlan !== undefined) {
            lines.push(` switchport trunk native vlan ${switchport.nativeVlan}`);
        }
        if (switchport.allowedVlans !== undefined) {
            lines.push(` switchport trunk allowed vlan ${switchport.allowedVlans.length ? formatVlanList(switchport.allowedVlans) : "none"}`);
        }
        if (nonegotiate) {
            lines.push(" switchport nonegotiate");
        }
    }
    return lines;
}

export function formatVlanList(vlans: readonly number[]): string {
    const sorted = [...new Set(vlans)].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const start = sorted[i];
        let end = start;
        while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
            end = sorted[++i];
        }
        parts.push(end - start >= 2 ? `${start}-${end}` : end === start ? `${start}` : `${start},${end}`);
    }
    return parts.join(",");
}
