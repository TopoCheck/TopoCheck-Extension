export type CommandContext = "interface" | "vlan" | "ospf" | "global";
interface Keyword {
  word: string;
  children?: Keyword[];
  tail?: "interface" | "route" | "text";
}
const key = (word: string, children?: Keyword[], tail?: Keyword["tail"]): Keyword => ({ word, children, tail });
const address = key("address");
const switchport = key("switchport", [
  key("mode", [key("access"), key("trunk")]),
  key("access", [key("vlan")]),
  key("trunk", [key("native", [key("vlan")]), key("allowed", [key("vlan", [
    key("add"), key("remove"), key("except"), key("all"), key("none")
  ])])])
]);
const interfaceChildren = [key("description", undefined, "text"), key("shutdown"), switchport];
const ospfChildren = [key("router-id"), key("network"), key("passive-interface", [key("default")], "interface")];

/** Resolve unique keyword prefixes within the supported grammar, not the complete IOS CLI. */
export function expandCiscoCommand(command: string, context: CommandContext): {
  command: string; error?: string;
} {
  const original = command;
  const ip = key("ip", [address, key("route", undefined, "route")]);
  const no = key("no", [key("shutdown"), key("description"), key("switchport"),
    key("ip", [address]), key("passive-interface", [key("default")], "interface")]);
  const globals = [key("hostname"), key("interface", undefined, "interface"), ip, no,
    key("router", [key("ospf")]), key("vlan"), key("end"), key("exit"),
    key("configure", [key("terminal")]), key("banner", undefined, "text")];
  const local = context === "interface" ? interfaceChildren : context === "ospf" ? ospfChildren :
    context === "vlan" ? [key("name")] : [];
  let choices = [...globals, ...local];
  const tokens = [...command.matchAll(/\S+/g)];
  const expanded: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index][0];
    const lower = token.toLowerCase();
    const exact = choices.find((item) => item.word === lower);
    const matches = exact ? [exact] : choices.filter((item) => item.word.startsWith(lower));
    if (matches.length > 1) {
      return { command: original, error: `Mehrdeutige Abkürzung '${token}': ${matches.map((item) => item.word).join(", ")}.` };
    }
    if (!matches.length) {
      // Preserve unknown syntax verbatim; the parser reports it in its original context.
      expanded.push(...tokens.slice(index).map((item) => item[0]));
      break;
    }
    const selected = matches[0];
    expanded.push(selected.word);
    if (selected.tail === "text") {
      // Descriptions and banner content must keep their original spacing and case.
      const start = tokens[index + 1]?.index;
      return { command: expanded.join(" ") + (start === undefined ? "" : ` ${command.slice(start)}`) };
    }
    if (selected.tail === "interface") {
      const next = tokens[index + 1]?.[0];
      if (next !== undefined) {
        expanded.push(selected.word === "passive-interface" && "default".startsWith(next.toLowerCase()) ? "default" : expandInterfaceName(next));
        index++;
      }
    }
    if (selected.tail === "route") {
      expanded.push(...tokens.slice(index + 1).map((item) => expandInterfaceName(item[0])));
      break;
    }
    if (selected.word === "network") {
      // network <address> <wildcard> area <value>: values are never abbreviated.
      expanded.push(...tokens.slice(index + 1, index + 3).map((item) => item[0]));
      index += Math.min(2, tokens.length - index - 1);
      choices = [key("area")];
    } else {
      choices = selected.children ?? [];
    }
  }
  return { command: expanded.join(" ") };
}

function expandInterfaceName(value: string): string {
  const match = /^([A-Za-z]+)(\d+(?:\/\d+)*(?:\.\d+)?)$/.exec(value);
  if (!match) {
    return value;
  }
  const types = ["Ethernet", "FastEthernet", "GigabitEthernet", "Loopback", "Vlan", "Serial", "Null"];
  const matches = types.filter((type) => type.toLowerCase().startsWith(match[1].toLowerCase()));
  return matches.length === 1 ? `${matches[0]}${match[2]}` : value;
}
