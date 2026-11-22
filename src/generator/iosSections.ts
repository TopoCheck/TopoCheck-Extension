export function formatIosSection(title: string, blocks: readonly string[]): string {
    const content = joinIosBlocks(blocks);
    return content ? `! --- ${title} ---\n${content}` : "";
}

export function joinIosBlocks(blocks: readonly string[]): string {
    return blocks.filter((block) => block.trim()).join("\n\n");
}
