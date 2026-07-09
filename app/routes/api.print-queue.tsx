import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { requestOrigin, requireBridgeToken } from "~/lib/bridge.server";
import type { LabelPiece } from "~/lib/zpl.server";
import { orderLabelsZpl } from "~/lib/zpl.server";
import {
  listBedsNeedingLabels,
  markBedLabeled,
} from "~/models/bed.server";
import { getOrderScope } from "~/models/order.server";

/**
 * Print bridge queue.
 *
 *   GET  /api/print-queue        -> beds waiting to be labelled, with the ZPL
 *                                   label batch + traveler URL per order.
 *   POST /api/print-queue        -> body { bedId } acks a bed as printed.
 *
 * Auth: Authorization: Bearer <PRINT_BRIDGE_TOKEN> on both.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireBridgeToken(request);
  const origin = requestOrigin(request);
  const beds = await listBedsNeedingLabels();

  // Cache order-level totals so we compute each order's scope only once.
  const scopeCache = new Map<string, number>();
  async function orderTotalFor(orderName: string): Promise<number> {
    const cached = scopeCache.get(orderName);
    if (cached !== undefined) return cached;
    const scope = await getOrderScope(orderName);
    scopeCache.set(orderName, scope.totalPieces);
    return scope.totalPieces;
  }

  const queue = await Promise.all(
    beds.map(async (bed) => {
      // Group this bed's pieces by order.
      const byOrder = new Map<string, typeof bed.pieces>();
      for (const piece of bed.pieces) {
        const key = piece.job.shopifyOrderId;
        const list = byOrder.get(key) ?? [];
        list.push(piece);
        byOrder.set(key, list);
      }

      const orders = await Promise.all(
        [...byOrder.entries()].map(async ([shopifyOrderId, pieces]) => {
          const orderName = pieces[0].job.orderName;
          const orderTotal = await orderTotalFor(orderName);
          const labelPieces: LabelPiece[] = pieces.map((p) => ({
            qrCode: p.qrCode,
            orderName: p.job.orderName,
            size: p.job.size,
            material: p.job.material,
            pieceIndex: p.pieceIndex,
            pieceCount: p.job.quantity,
            orderTotal,
          }));
          return {
            orderName,
            shopifyOrderId,
            pieceCount: pieces.length,
            orderTotal,
            zebraZpl: orderLabelsZpl(labelPieces, origin),
            travelerUrl: `${origin}/station/traveler/${bed.id}?order=${encodeURIComponent(shopifyOrderId)}`,
          };
        }),
      );

      return { bedId: bed.id, workOrderNum: bed.workOrderNum, orders };
    }),
  );

  return json({ beds: queue });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  requireBridgeToken(request);
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let bedId: string | undefined;
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { bedId?: string };
    bedId = body.bedId;
  } else {
    bedId = String((await request.formData()).get("bedId") ?? "");
  }
  if (!bedId) return json({ error: "bedId required" }, { status: 400 });

  await markBedLabeled(bedId);
  return json({ ok: true });
};
