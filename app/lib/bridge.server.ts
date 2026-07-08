// Auth for the local print bridge. The bridge polls Print Station and fetches
// travelers server-to-server, so it authenticates with a shared token
// (PRINT_BRIDGE_TOKEN) rather than a staff session.

export function requireBridgeToken(request: Request): void {
  const expected = process.env.PRINT_BRIDGE_TOKEN;
  if (!expected) {
    throw new Response("Print bridge not configured", { status: 503 });
  }
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== expected) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

export function requestOrigin(request: Request): string {
  const host =
    request.headers.get("X-Forwarded-Host") ??
    request.headers.get("host") ??
    "localhost:3000";
  const proto =
    request.headers.get("X-Forwarded-Proto") ??
    (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
