// Bed capacity — how many pieces of a given size/material fit on one bed.
// The actual numbers come from Bedster's imposition templates (fetched
// server-side via getCapacityMap in bedster.server.ts). This module only
// holds client-safe helpers for keying and computing fill.

export function normalizeSize(size: string): string {
  return size.trim().toLowerCase().replace(/\s+/g, "");
}

// Fallback capacities by size, used only when Bedster's /api/templates
// hasn't provided one. Bedster is the source of truth; these keep the fill
// bars working until that endpoint exists.
const DEFAULT_CAPACITY_BY_SIZE: Record<string, number> = {
  // Verified from IDML frame counts:
  "4x4": 30,
  "5x7": 18,
  "6x6": 18,
  // Unverified guesses — Bedster overrides these once its templates exist:
  "2x2": 63,
  "2x3": 42,
  "8x8": 10,
  "8x10": 4,
  "11x14": 4,
  "12x14": 10,
};

export function defaultCapacity(size: string): number | null {
  return DEFAULT_CAPACITY_BY_SIZE[normalizeSize(size)] ?? null;
}

/**
 * Cache/lookup key for a capacity. Capacity depends on piece size (how many
 * fit on the tray), not material, so we key by size alone.
 */
export function capacityKey(size: string): string {
  return normalizeSize(size);
}

/**
 * Percentage (0–100, rounded) of a bed filled by `count` pieces, given the
 * bed's capacity. Returns 0 when capacity is unknown.
 */
export function fillPercent(
  count: number,
  capacity: number | null | undefined,
): number {
  if (!capacity || capacity <= 0) return 0;
  return Math.min(100, Math.round((count / capacity) * 100));
}
