import type { ReadingPosition } from "./types";

/**
 * Text-based anchor used when an EPUB is reflowed or edited between devices.
 * The raw token is retained for display; matching uses a normalized form so
 * punctuation and Unicode normalization do not move the reading cursor.
 */
export interface TextAnchor {
  wordIndex: number;
  exactText: string;
  prefix: string;
  suffix: string;
}

export function normalizeAnchorToken(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("pt-BR")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function createTextAnchor(words: string[], index: number, contextSize = 8): TextAnchor | null {
  if (!words.length) return null;
  const safeIndex = Math.max(0, Math.min(index, words.length - 1));
  return {
    wordIndex: safeIndex,
    exactText: words[safeIndex],
    prefix: words.slice(Math.max(0, safeIndex - contextSize), safeIndex).join(" "),
    suffix: words.slice(safeIndex + 1, safeIndex + contextSize + 1).join(" ")
  };
}

/** Resolve the closest occurrence of an anchor, preserving the old index as a tie-breaker. */
export function resolveTextAnchor(words: string[], position: ReadingPosition, fallback: number): number {
  if (!words.length) return 0;
  const exact = position.exactText ?? position.word;
  if (!exact) return Math.max(0, Math.min(fallback, words.length - 1));
  const target = normalizeAnchorToken(exact);
  if (!target) return Math.max(0, Math.min(fallback, words.length - 1));
  const prefix = (position.prefix ?? (position.contextBefore ?? []).join(" ")).split(/\s+/).filter(Boolean).map(normalizeAnchorToken);
  const suffix = (position.suffix ?? (position.contextAfter ?? []).join(" ")).split(/\s+/).filter(Boolean).map(normalizeAnchorToken);
  let bestIndex = -1;
  let bestScore = -Infinity;
  words.forEach((word, index) => {
    if (normalizeAnchorToken(word) !== target) return;
    let score = 0;
    prefix.forEach((token, offset) => {
      const candidate = words[index - (prefix.length - offset)];
      if (candidate && normalizeAnchorToken(candidate) === token) score += 3;
    });
    suffix.forEach((token, offset) => {
      const candidate = words[index + offset + 1];
      if (candidate && normalizeAnchorToken(candidate) === token) score += 3;
    });
    score -= Math.min(2, Math.abs(index - fallback) / 1000);
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  });
  return bestIndex >= 0 ? bestIndex : Math.max(0, Math.min(fallback, words.length - 1));
}
