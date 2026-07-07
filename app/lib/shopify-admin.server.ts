// Shopify Admin API helpers. Used to enrich order data that isn't present
// in the order webhook payload — notably material, which lives on the
// product (tags or a metafield). All calls degrade gracefully: if the
// Admin API isn't configured, callers get null and fall back to parsing.

interface AdminConfig {
  domain: string;
  token: string;
  version: string;
  metafield?: string; // "namespace.key"
}

function readConfig(): AdminConfig | null {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) return null;
  return {
    domain,
    token,
    version: process.env.SHOPIFY_API_VERSION || "2024-10",
    metafield: process.env.SHOPIFY_MATERIAL_METAFIELD || undefined,
  };
}

export function isAdminConfigured(): boolean {
  return readConfig() !== null;
}

const KNOWN_MATERIALS: Array<[string, string]> = [
  ["acrylic", "Acrylic Block"],
  ["metal", "Metal Print"],
  ["canvas", "Canvas"],
  ["wood", "Wood Print"],
  ["glass", "Glass Print"],
  ["frame", "Framed Print"],
  ["paper", "Photo Paper"],
];

/** Match known material keywords in free text (tags, product type). */
export function matchMaterial(text: string): string | null {
  const haystack = text.toLowerCase();
  for (const [keyword, label] of KNOWN_MATERIALS) {
    if (haystack.includes(keyword)) return label;
  }
  return null;
}

interface ProductResponse {
  product?: { tags?: string; product_type?: string };
}
interface MetafieldsResponse {
  metafields?: { namespace: string; key: string; value: string }[];
}

/**
 * Resolve a product's material via the Admin API. Prefers a configured
 * metafield (SHOPIFY_MATERIAL_METAFIELD="namespace.key"); otherwise matches
 * known material keywords in the product's tags and product type. Returns
 * null if unconfigured, not found, or on any error.
 */
export async function fetchProductMaterial(
  productId: string | number,
): Promise<string | null> {
  const cfg = readConfig();
  if (!cfg) return null;

  const base = `https://${cfg.domain}/admin/api/${cfg.version}`;
  const headers = {
    "X-Shopify-Access-Token": cfg.token,
    "Content-Type": "application/json",
  };

  try {
    if (cfg.metafield && cfg.metafield.includes(".")) {
      const [ns, key] = cfg.metafield.split(".");
      const res = await fetch(
        `${base}/products/${productId}/metafields.json`,
        { headers },
      );
      if (res.ok) {
        const data = (await res.json()) as MetafieldsResponse;
        const mf = data.metafields?.find(
          (m) => m.namespace === ns && m.key === key,
        );
        if (mf?.value) return String(mf.value).trim();
      }
    }

    const res = await fetch(`${base}/products/${productId}.json`, { headers });
    if (!res.ok) return null;
    const data = (await res.json()) as ProductResponse;
    const product = data.product ?? {};

    return (
      matchMaterial(product.tags ?? "") ??
      matchMaterial(product.product_type ?? "")
    );
  } catch {
    return null;
  }
}
