// Bed capacity — how many pieces of a given size/material fit on one bed.
// The actual numbers come from Bedster's imposition templates (fetched
// server-side via getCapacityMap in bedster.server.ts). This module only
// holds client-safe helpers for keying and computing fill.

export function normalizeSize(size: string): string {
  return size.trim().toLowerCase().replace(/\s+/g, "");
}

/** Cache/lookup key for a capacity: size + material, normalized. */
export function capacityKey(size: string, material: string): string {
  return `${normalizeSize(size)}|${material.trim().toLowerCase()}`;
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
