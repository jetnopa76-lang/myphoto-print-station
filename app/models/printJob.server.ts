import type { PrintJob } from "@prisma/client";
import { prisma } from "~/db.server";
import type { ShopifyLineItem, ShopifyOrder } from "~/lib/shopify.server";
import {
  getLineItemProperty,
  hasMyphotoTag,
  lineItemImageUrl,
  parseMaterial,
  parseSize,
} from "~/lib/shopify.server";
import {
  fetchProductInfo,
  isAdminConfigured,
} from "~/lib/shopify-admin.server";

export type { PrintJob };

/** Stable key for webhook idempotency: one PrintJob per order line item. */
export function lineItemKey(orderId: number, lineItemId: number): string {
  return `${orderId}-${lineItemId}`;
}

function frameCountFor(item: ShopifyLineItem): number {
  const raw = getLineItemProperty(item, "Frames");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export interface UpsertResult {
  created: number;
  skipped: number; // already existed (idempotent replay)
  jobIds: string[];
}

/**
 * Create a PrintJob for each *print-product* line item in an order.
 *
 * Which line items count as print products:
 *  - If the Admin API is configured, we look up each product and include it
 *    only if it carries the `myphoto` tag (skipping non-print items in the
 *    same order). Material comes from the same lookup.
 *  - If the Admin API isn't configured, we fall back to the order-level
 *    `myphoto` tag (how admin-created orders are tagged): include every line
 *    item when the order is tagged, none otherwise.
 *
 * Idempotent: re-delivering the same webhook won't duplicate (dedupe on
 * lineItemKey), so it's safe to receive both orders/create and orders/updated.
 */
export async function upsertJobsFromOrder(
  order: ShopifyOrder,
): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, skipped: 0, jobIds: [] };
  const adminOn = isAdminConfigured();
  const orderTagged = hasMyphotoTag(order);

  for (const item of order.line_items) {
    const key = lineItemKey(order.id, item.id);

    const existing = await prisma.printJob.findUnique({
      where: { lineItemKey: key },
      select: { id: true },
    });
    if (existing) {
      result.skipped += 1;
      result.jobIds.push(existing.id);
      continue;
    }

    const size = parseSize(item) ?? "unknown";
    let material = parseMaterial(item) ?? "unknown";

    // Decide whether this line item is a print product, and enrich material.
    let include: boolean;
    if (lineItemImageUrl(item)) {
      // The customer uploaded a photo (editor property) — it's a print item.
      include = true;
    } else if (adminOn && item.product_id) {
      const info = await fetchProductInfo(item.product_id);
      if (info) {
        include = info.isPrintProduct;
        if (info.material) material = info.material;
      } else {
        include = orderTagged; // Admin lookup failed — fall back to order tag
      }
    } else {
      include = orderTagged; // no Admin API — rely on the order tag
    }

    if (!include) continue; // not a print product; skip this line item

    const job = await prisma.printJob.create({
      data: {
        shopifyOrderId: order.admin_graphql_api_id,
        orderName: order.name,
        lineItemId: String(item.id),
        lineItemKey: key,
        sku: item.sku ?? "",
        // productHandle isn't in the order webhook payload; store the
        // product id as a stand-in until we enrich via the Admin API.
        productHandle: item.product_id ? String(item.product_id) : "",
        productTitle: item.title,
        variantTitle: item.variant_title ?? "",
        size,
        material,
        quantity: item.quantity,
        properties: (item.properties ?? []) as object,
        frameCount: frameCountFor(item),
        status: "pending",
        events: {
          create: {
            action: "created",
            note: `Imported from Shopify order ${order.name}`,
          },
        },
      },
      select: { id: true },
    });

    result.created += 1;
    result.jobIds.push(job.id);
  }

  return result;
}
