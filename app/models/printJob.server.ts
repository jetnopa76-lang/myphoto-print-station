import type { PrintJob } from "@prisma/client";
import { prisma } from "~/db.server";
import type { ShopifyLineItem, ShopifyOrder } from "~/lib/shopify.server";
import {
  getLineItemProperty,
  parseMaterial,
  parseSize,
} from "~/lib/shopify.server";
import {
  fetchProductMaterial,
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
 * Create a PrintJob for each line item in a myphoto order. Idempotent:
 * re-delivering the same webhook will not create duplicates (dedupe on
 * lineItemKey). Unparseable size/material fall back to "unknown" so the
 * job still surfaces for staff rather than being silently dropped.
 */
export async function upsertJobsFromOrder(
  order: ShopifyOrder,
): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, skipped: 0, jobIds: [] };

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

    // Material usually lives on the product (tags/metafield), which isn't in
    // the webhook payload — enrich via the Admin API when it's unresolved.
    if (material === "unknown" && item.product_id && isAdminConfigured()) {
      const enriched = await fetchProductMaterial(item.product_id);
      if (enriched) material = enriched;
    }

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
