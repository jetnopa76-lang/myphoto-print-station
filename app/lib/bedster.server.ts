import crypto from "node:crypto";

import type { Bed, BedItem, PrintJob } from "@prisma/client";

import type { ShopifyLineItemProperty } from "~/lib/shopify.server";

export class BedsterConfigError extends Error {}

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
