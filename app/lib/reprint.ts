// Shared (client-safe) reprint constants and helpers — no server imports.

export const REPRINT_REASONS = [
  "Print defect",
  "Color off",
  "Damaged in production",
  "Wrong crop",
  "Scratches or marks",
  "Adhesion issue",
  "Other",
] as const;

export type ReprintReason = (typeof REPRINT_REASONS)[number];

/** A job is a reprint when its line-item key was cloned with a reprint tag. */
export function isReprintJob(lineItemKey: string): boolean {
  return lineItemKey.includes("-reprint-");
}
