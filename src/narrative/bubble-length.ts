/**
 * GDD 2.8 writing rule check for world bubbles (dev builds only): max 2 short sentences per bubble. "Mr." / "Mrs." /
 * "Dr." / "St." / "Mt." are not sentence ends (validate-dialogue.mjs counts the same way); "..." trails off.
 */
const SENTENCE_END = /[.!?…।]+(?=\s|$)/gu;
const ABBREV = /\b(Mr|Mrs|Ms|Dr|St|Mt)\./g;

export function sentenceCount(text: string): number {
  const plain = text.trim().replace(ABBREV, '$1').replace(/\.{3}|…/g, ',');
  return plain.match(SENTENCE_END)?.length ?? 0;
}

/** Warns once per key (into `warned`) when a bubble's text has more than 2 sentences. */
export function warnLongBubble(key: string, text: string, warned: Set<string>): void {
  if (!import.meta.env.DEV || warned.has(key)) return;
  const n = sentenceCount(text);
  if (n <= 2) return;
  warned.add(key);
  console.warn(`[SpeechBubbles] "${key}" has ${n} sentences (GDD 2.8: max 2 per bubble)`);
}
