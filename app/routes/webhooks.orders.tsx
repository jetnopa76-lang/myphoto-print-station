import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import type { ShopifyOrder } from "~/lib/shopify.server";
import { hasMyphotoTag, verifyShopifyWebhook } from "~/lib/shopify.server";
import { upsertJobsFromOrder } from "~/models/printJob.server";

/**
 * Shopify order webhook receiver.
 *
 * Configure Shopify to POST orders/create (or orders/paid) here. We verify
 * the HMAC, ignore any order without the `myphoto` tag, and create one
 * PrintJob per line item. Idempotent on redelivery.
 *
 * Always returns 2xx for accepted/ignored payloads so Shopify doesn't retry;
 * only bad signatures (401) and unexpected errors (500) are non-2xx.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const rawBody = await verifyShopifyWebhook(request);
  if (rawBody === null) {
    return json({ error: "Invalid signature" }, { status: 401 });
  }

  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!hasMyphotoTag(order)) {
    return json({ ignored: true, reason: "no myphoto tag" }, { status: 200 });
  }

  try {
    const result = await upsertJobsFromOrder(order);
    return json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    console.error("webhooks/orders failed", { orderName: order.name, error });
    return json({ error: "Processing failed" }, { status: 500 });
  }
};

// No loader — GET should 404 rather than render.
