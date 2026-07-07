/**
 * study-cards.ts — pure ordering helper for the flashcards sub-view. Cards whose
 * SRS key is due today surface first (repaso mode); relative order is otherwise
 * preserved (stable sort). Pure → unit-testable.
 */

export function orderDueFirst<T>(
  cards: T[],
  dueKeys: string[] | undefined,
  keyOf: (card: T) => string,
): T[] {
  if (!dueKeys || dueKeys.length === 0) return cards
  const due = new Set(dueKeys)
  return [...cards].sort((a, b) => (due.has(keyOf(a)) ? 0 : 1) - (due.has(keyOf(b)) ? 0 : 1))
}
