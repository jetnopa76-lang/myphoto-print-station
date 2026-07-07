/**
 * How many pieces of a given size nest onto one print bed. Values taken
 * from the reference bed-maker. Keyed by normalized size (lowercase "5x7").
 *
 * TODO(jorge): confirm these per your imposition; this could later move to
 * the database if capacities vary by material or press.
 */
const BED_CAPACITY: Record<string, number> = {
  "2x2": 63,
  "2x3": 42,
  "4x4": 15,
  "5x7": 9,
  "8x8": 10,
  "8x10": 4,
  "11x14": 4,
  "12x14": 10,
};

const DEFAULT_CAPACITY = 1;

export function normalizeSize(size: string): string {
  return size.trim().toLowerCase().replace(/\s+/g, "");
}

/** Pieces that fit on one bed for the given size. */
export function bedCapacity(size: string): number {
  return BED_CAPACITY[normalizeSize(size)] ?? DEFAULT_CAPACITY;
}

/** Percentage (0–100, rounded) of a bed filled by `count` pieces. */
export function fillPercent(count: number, size: string): number {
  const cap = bedCapacity(size);
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((count / cap) * 100));
}
