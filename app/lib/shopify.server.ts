import crypto from "node:crypto";

import invariant from "tiny-invariant";

invariant(
  process.env.SHOPIFY_WEBHOOK_SECRET,
  "SHOPIFY_WEBHOOK_SECRET must be set",
);

const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

/** The order tag that flags an order for the Print Station pipeline. */
export const MYPHOTO_TAG = "myphoto";

// ─────────────────────────────────────────────────────
// Minimal typings for the bits of the Shopify order webhook we use.
// The payload has many more fields; we only declare what we read.
// ─────────────────────────────────────────────────────

export interface ShopifyLineItemProperty {
  name: string;
  value: string;
}

export interface ShopifyLineItem {
  id: number;
  sku: string | null;
  title: string;
  variant_title: string | null;
  quantity: number;
  product_id: number | null;
  properties?: ShopifyLineItemProperty[];
}

export interface ShopifyOrder {
  id: number;
  name: string; // "#1042"
  admin_graphql_api_id: string; // "gid://shopify/Order/12345"
  tags: string; // comma-separated
  line_items: ShopifyLineItem[];
}

/**
 * Verify a Shopify webhook's HMAC signature against the raw request body.
 * Shopify signs the *raw bytes* of the body, so we must read the body as
 * text before JSON-parsing it. Uses a timing-safe comparison.
 *
 * Returns the raw body string on success (so the caller can JSON.parse it),
 * or null if verification fails.
 */
export async function verifyShopifyWebhook(
  request: Request,
): Promise<string | null> {
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader) return null;

  const rawBody = await request.text();

  const digest = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return rawBody;
}

/** True if the order carries the `myphoto` tag (case-insensitive). */
export function hasMyphotoTag(order: ShopifyOrder): boolean {
  return order.tags
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .includes(MYPHOTO_TAG);
}

/** Read a named line-item property (case-insensitive), if present. */
export function getLineItemProperty(
  item: ShopifyLineItem,
  name: string,
): string | undefined {
  return item.properties?.find(
    (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase(),
  )?.value;
}

/**
 * Parse a print size like "5x7" out of a variant title or property.
 * Matches patterns like "5x7", "5 x 7", "8X10", "11×14".
 * Returns a normalized "WxH" string, or null if none found.
 *
 * TODO(jorge): confirm where size actually lives in your product data.
 * Right now this checks the "Size" property first, then variant_title.
 */
export function parseSize(item: ShopifyLineItem): string | null {
  const candidates = [
    getLineItemProperty(item, "Size"),
    item.variant_title ?? undefined,
    item.title,
  ].filter((s): s is string => Boolean(s));

  for (const text of candidates) {
    const match = text.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (match) return `${match[1]}x${match[2]}`;
  }
  return null;
}

/**
 * Determine the material (e.g. "Acrylic Block", "Metal Print").
 *
 * TODO(jorge): product tags/metafields are NOT included in the order
 * webhook payload, so material must come from a line-item property, the
 * SKU, or the variant title. This checks a "Material" property first,
 * then looks for known keywords in the title/variant. Refine to match
 * your real SKU/property conventions.
 */
export function parseMaterial(item: ShopifyLineItem): string | null {
  const explicit = getLineItemProperty(item, "Material");
  if (explicit) return explicit.trim();

  const haystack = `${item.title} ${item.variant_title ?? ""} ${
    item.sku ?? ""
  }`.toLowerCase();

  const known: Array<[string, string]> = [
    ["acrylic", "Acrylic Block"],
    ["metal", "Metal Print"],
    ["canvas", "Canvas"],
    ["wood", "Wood Print"],
    ["paper", "Photo Paper"],
  ];
  for (const [keyword, label] of known) {
    if (haystack.includes(keyword)) return label;
  }
  return null;
}
