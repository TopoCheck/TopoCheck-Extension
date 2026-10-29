/** Optional device settings shared by persisted topology data and the H1c model. */
export interface DeviceAccessConfiguration {
    domainName?: string;
    username?: string;
    enableSecret?: string;
    consolePassword?: string;
    vtyPassword?: string;
    banner?: string;
}
