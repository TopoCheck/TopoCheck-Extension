export * from "./types";
import { planSwitching } from "./planSwitching";
import { renderSwitchIos } from "./renderSwitchIos";
import type { SwitchingOptions, SwitchingTopologyInput, SwitchingWarning } from "./types";

export * from "./types";
export { planSwitching } from "./planSwitching";
export { renderSwitchIos, formatVlanList } from "./renderSwitchIos";

export interface GeneratedSwitchConfig {
    deviceId: string;
    hostname: string;
    config: string;
}

export function generateSwitchingConfigurations(
    input: SwitchingTopologyInput,
    options: Partial<SwitchingOptions> = {}
): { configs: GeneratedSwitchConfig[]; warnings: SwitchingWarning[] } {
    const plan = planSwitching(input, options);
    return {
        configs: plan.switches.map((sw) => ({ deviceId: sw.deviceId, hostname: sw.hostname, config: renderSwitchIos(sw) })),
        warnings: plan.warnings
    };
}
