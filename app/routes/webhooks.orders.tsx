import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import type { ShopifyOrder } from "~/lib/shopify.server";
import { verifyShopifyWebhook } from "~/lib/shopify.server";
import { upsertJobsFromOrder } from "~/models/printJob.server";

/**
 * Shopify order webhook receiver.
 *
 * Configure Shopify to POST orders/create (and orders/updated) here. We verify
 * the HMAC, then create a PrintJob for each *print-product* line item. Which
 * line items count is decided per item in upsertJobsFromOrder (product tag via
 * Admin API, or order tag as fallback). Idempotent on redelivery.
 *
 * Always returns 2xx for accepted payloads so Shopify doesn't retry; only bad
 * signatures (401) and unexpected errors (500) are non-2xx.
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

  try {
    const result = await upsertJobsFromOrder(order);
    return json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    console.error("webhooks/orders failed", { orderName: order.name, error });
    return json({ error: "Processing failed" }, { status: 500 });
  }
};

// No loader — GET should 404 rather than render.
