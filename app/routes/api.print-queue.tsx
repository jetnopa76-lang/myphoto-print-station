import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { requestOrigin, requireBridgeToken } from "~/lib/bridge.server";
import type { LabelPiece } from "~/lib/zpl.server";
import { orderLabelsZpl } from "~/lib/zpl.server";
import { getOrderScope } from "~/models/order.server";
import { listOrderLabelJobs, markOrderLabeled } from "~/models/station.server";

/**
 * Print bridge queue — now per ORDER, not per bed.
 *
 *   GET  /api/print-queue   -> orders the worker approved at the bed, each with
 *                              its ZPL label batch + traveler URL.
 *   POST /api/print-queue   -> body { bedId, shopifyOrderId } acks one order.
 *
 * Each order is queued independently when the worker clicks "Approve & print"
 * on the guided load screen, and prints immediately.
 *
 * Auth: Authorization: Bearer <PRINT_BRIDGE_TOKEN> on both.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireBridgeToken(request);
  const origin = requestOrigin(request);
  const labelJobs = await listOrderLabelJobs();

  // Cache each order's whole-order total (for the MULTI banner) once.
  const totalCache = new Map<string, number>();
  async function orderTotalFor(orderName: string): Promise<number> {
    const cached = totalCache.get(orderName);
    if (cached !== undefined) return cached;
    const scope = await getOrderScope(orderName);
    totalCache.set(orderName, scope.totalPieces);
    return scope.totalPieces;
  }

  const jobs = await Promise.all(
    labelJobs.map(async (j) => {
      const orderTotal = await orderTotalFor(j.orderName);
      const labelPieces: LabelPiece[] = j.pieces.map((p) => ({
        qrCode: p.qrCode,
        orderName: p.orderName,
        size: p.size,
        material: p.material,
        pieceIndex: p.pieceIndex,
        pieceCount: p.quantity,
        orderTotal,
      }));
      return {
        bedId: j.bedId,
        workOrderNum: j.workOrderNum,
        orderName: j.orderName,
        shopifyOrderId: j.shopifyOrderId,
        pieceCount: j.pieces.length,
        orderTotal,
        zebraZpl: orderLabelsZpl(labelPieces, origin),
        travelerUrl: `${origin}/station/traveler/${j.bedId}?order=${encodeURIComponent(j.shopifyOrderId)}`,
      };
    }),
  );

  return json({ jobs });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  requireBridgeToken(request);
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let bedId: string | undefined;
  let shopifyOrderId: string | undefined;
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      bedId?: string;
      shopifyOrderId?: string;
    };
    bedId = body.bedId;
    shopifyOrderId = body.shopifyOrderId;
  } else {
    const form = await request.formData();
    bedId = String(form.get("bedId") ?? "");
    shopifyOrderId = String(form.get("shopifyOrderId") ?? "");
  }
  if (!bedId || !shopifyOrderId) {
    return json({ error: "bedId and shopifyOrderId required" }, { status: 400 });
  }

  await markOrderLabeled(bedId, shopifyOrderId);
  return json({ ok: true });
};
