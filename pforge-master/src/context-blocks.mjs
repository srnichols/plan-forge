import { normalizeTurnInput } from "./turn-input.mjs";

export const OPERATOR_CONTEXT_HEADING = "## Operator context (supplied by caller)";

/**
 * @param {Array<{ title: string, text: string }> | undefined} blocks
 * @returns {{ text: string, truncated: boolean }}
 */
export function renderContextBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return { text: "", truncated: false };

  try {
    const normalized = normalizeTurnInput({ contextBlocks: blocks });
    if (!normalized.ok) return { text: "", truncated: false };

    const normalizedBlocks = normalized.input.contextBlocks;
    const text = `${OPERATOR_CONTEXT_HEADING}\n\n${normalizedBlocks
      .map((block) => `### ${block.title.replace(/\s+/g, " ").trim()}\n${block.text}`)
      .join("\n\n")}`;
    return { text, truncated: normalized.truncated?.context === true };
  } catch {
    return { text: "", truncated: false };
  }
}

/**
 * @param {string} contextBlock
 * @param {Array<{ title: string, text: string }> | undefined} blocks
 * @returns {string}
 */
export function appendContextBlocks(contextBlock, blocks) {
  const rendered = renderContextBlocks(blocks).text;
  if (!rendered) return contextBlock;
  return ((contextBlock || "").trimEnd() + "\n\n" + rendered).trimStart();
}
