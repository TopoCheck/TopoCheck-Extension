/**
 * Bauplan für die Demo Topologie
*/

import type { DeviceType, Position } from "./models";

export interface DemoDevice {
    type: DeviceType;
    position: Position;
}

export interface DemoPlan {
    devices: DemoDevice[];
    links: [number, number][];
}

const ROUTER_SPACING = 520;
const SWITCH_OFFSET = 140;
const LEVEL_HEIGHT = 180;
const PC_SPACING = 70;

export function buildDemoPlan(deviceCount: number): DemoPlan {
    const devices: DemoDevice[] = [];
    const links: [number, number][] = [];
    const add = (type: DeviceType, x: number, y: number): number => {
        devices.push({ type, position: { x, y } });
        return devices.length - 1;
    };

    let previousRouter: number | undefined;
    for (let r = 0; devices.length < deviceCount; r++) {
        const routerX = r * ROUTER_SPACING;
        const router = add("router", routerX, 0);
        if (previousRouter !== undefined) {
            links.push([previousRouter, router]);
        }
        previousRouter = router;

        for (const side of [-1, 1]) {
            if (devices.length >= deviceCount) {
                break;
            }
            const switchX = routerX + side * SWITCH_OFFSET;
            const sw = add("switch", switchX, LEVEL_HEIGHT);
            links.push([router, sw]);

            for (let p = 0; p < 4 && devices.length < deviceCount; p++) {
                const pcX = switchX + (p - 1.5) * PC_SPACING;
                const pcY = LEVEL_HEIGHT * 2 + (p % 2) * 80;
                const pc = add("pc", pcX, pcY);
                links.push([sw, pc]);
            }
        }
    }

    return { devices, links };
}

export function demoInterfaceName(type: DeviceType, index: number): string {
    switch (type) {
        case "router":
            return `GigabitEthernet0/${index}`;
        case "switch":
            return `FastEthernet0/${index + 1}`;
        case "pc":
            return `Ethernet${index}`;
    }
}