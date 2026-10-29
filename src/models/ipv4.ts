/** Shared IPv4 value rules for the H1c model and configuration validation. */
export function isValidIpv4Address(value: string): boolean {
    const octets = value.split(".");
    return octets.length === 4 && octets.every((octet) =>
        /^\d{1,3}$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255);
}

/** A mask consists of contiguous network bits, followed by host bits (/0 to /32). */
export function isValidSubnetMask(value: string): boolean {
    return isValidIpv4Address(value) && /^1*0*$/.test(value.split(".")
        .map((part) => Number(part).toString(2).padStart(8, "0")).join(""));
}
