import crypto from "node:crypto";

import type { Bed, BedItem, PrintJob } from "@prisma/client";

import { capacityKey } from "~/lib/bed-capacity";
import type { ShopifyLineItemProperty } from "~/lib/shopify.server";

export class BedsterConfigError extends Error {}

// ─────────────────────────────────────────────────────
// Bed capacities — sourced from Bedster's imposition templates.
// ─────────────────────────────────────────────────────

export interface BedsterTemplate {
  size: string;
  material: string;
  capacity: number; // pieces per bed
}

let capacityCache: { map: Record<string, number>; at: number } | null = null;
const CAPACITY_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch the imposition templates (size/material → capacity) from Bedster.
 * Returns [] if Bedster isn't configured or the request fails, so callers
 * degrade to "unknown capacity" rather than erroring.
 */
export async function fetchBedsterTemplates(): Promise<BedsterTemplate[]> {
  const apiUrl = process.env.BEDSTER_API_URL;
  const apiKey = process.env.BEDSTER_API_KEY;
  if (!apiUrl || !apiKey) return [];

  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/templates`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as
      | { templates?: BedsterTemplate[] }
      | BedsterTemplate[];
    const list = Array.isArray(data) ? data : (data.templates ?? []);
    return list.filter(
      (t) =>
        t &&
        typeof t.size === "string" &&
        typeof t.material === "string" &&
        typeof t.capacity === "number",
    );
  } catch {
    return [];
  }
}

/**
 * Capacity lookup keyed by `capacityKey(size, material)`. Cached for a few
 * minutes so we don't hit Bedster on every page load. Empty map when Bedster
 * is unconfigured/unreachable.
 */
export async function getCapacityMap(): Promise<Record<string, number>> {
  if (capacityCache && Date.now() - capacityCache.at < CAPACITY_TTL_MS) {
    return capacityCache.map;
  }
  const templates = await fetchBedsterTemplates();
  const map: Record<string, number> = {};
  for (const t of templates) {
    map[capacityKey(t.size, t.material)] = t.capacity;
  }
  capacityCache = { map, at: Date.now() };
  return map;
}

function requireConfig(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new BedsterConfigError(
      `${name} is not set. Configure Bedster in your environment before sending beds.`,
    );
  }
  return value;
}

/**
 * Best-effort extraction of the customer's uploaded image URL from a job's
 * Shopify line-item properties. Looks for a property value that is an
 * http(s) URL.
 *
 * TODO(jorge): tighten this to the exact property name your storefront uses
 * (see docs/bedster-api.md).
 */
export function extractImageUrl(job: PrintJob): string | null {
  const props = (job.properties ?? []) as unknown as ShopifyLineItemProperty[];
  if (!Array.isArray(props)) return null;

  for (const prop of props) {
    const value = typeof prop?.value === "string" ? prop.value : "";
    if (/^https?:\/\/\S+/i.test(value)) return value;
  }
  return null;
}

export interface ImposePiece {
  orderName: string;
  imageUrl: string | null;
  quantity: number;
}

export interface ImposeResult {
  accepted: boolean;
  bedsterJobId?: string;
}

type BedWithItems = Bed & { items: (BedItem & { job: PrintJob })[] };

/**
 * Submit a bed to Bedster for imposition. Asynchronous on Bedster's side:
 * this call only confirms receipt; the finished print file arrives later
 * via the callback webhook.
 */
export async function sendBedToBedster(
  bed: BedWithItems,
  callbackUrl: string,
): Promise<ImposeResult> {
  const apiUrl = requireConfig("BEDSTER_API_URL");
  const apiKey = requireConfig("BEDSTER_API_KEY");

  const pieces: ImposePiece[] = bed.items.map((item) => ({
    orderName: item.job.orderName,
    imageUrl: extractImageUrl(item.job),
    quantity: item.quantity,
  }));

  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/impose`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      workOrderNum: bed.workOrderNum,
      size: bed.size,
      material: bed.material,
      callbackUrl,
      pieces,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Bedster rejected the bed (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  const data = (await response.json().catch(() => ({}))) as ImposeResult;
  return { accepted: data.accepted ?? true, bedsterJobId: data.bedsterJobId };
}

export interface BedsterCallback {
  workOrderNum: string;
  status: string; // "imposed" | "failed" | ...
  printFileUrl?: string;
}

/**
 * Verify the shared secret on an incoming Bedster callback and return the
 * parsed body, or null if the secret is missing/wrong or the body is bad.
 */
export async function verifyBedsterWebhook(
  request: Request,
): Promise<BedsterCallback | null> {
  const expected = requireConfig("BEDSTER_WEBHOOK_SECRET");
  const provided = request.headers.get("x-bedster-secret") ?? "";

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    const body = (await request.json()) as BedsterCallback;
    if (!body?.workOrderNum || typeof body.workOrderNum !== "string") {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}
