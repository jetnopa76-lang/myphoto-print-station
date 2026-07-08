// Client-safe helpers for USB (keyboard-wedge) barcode/QR scanners.

/** Pull a PS- piece code out of a scanned value (raw code or a scan URL). */
export function extractPieceCode(value: string): string {
  const s = value.trim();
  const m = s.match(/PS-[0-9A-Za-z]+/i);
  return m ? m[0].toUpperCase() : s.toUpperCase();
}

/**
 * Given a scanned value, return the in-app path to navigate to, or null if it
 * isn't one of our codes. Handles full app URLs and bare PS- piece codes.
 */
export function scanPath(value: string): string | null {
  const s = value.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (/^\/(scan|station|pack|beds)\//.test(u.pathname)) {
      return u.pathname + u.search;
    }
  } catch {
    // not a URL — fall through
  }
  if (/^PS-/i.test(s)) return `/scan/${s.toUpperCase()}`;
  return null;
}
