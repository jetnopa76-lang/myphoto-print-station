import { prisma } from "~/db.server";

import { getOrderScope } from "./order.server";

// ─────────────────────────────────────────────────────
// Guided bed-loading + per-order label printing.
//
// The station worker scans a bed's work-order QR, which opens a step-through
// of that bed's orders (one at a time, showing each order's customer photos).
// Clicking "Approve & print" flips that order's pieces to `labels_requested`;
// the print bridge polls for those, prints the piece labels (Zebra) + traveler
// (Star) for just that order, then acks — which sets the pieces back to
// `printed` and logs a `labels_printed` event so the screen can show it as done.
//
// This is all migration-free: it rides on PrintPiece.status + PieceEvent,
// which already exist, so no schema change / prisma generate is needed.
// ─────────────────────────────────────────────────────

const LABELS_REQUESTED = "labels_requested";
const LABELS_PRINTED_EVENT = "labels_printed";

/** Pull any http(s) image URLs out of a job's stored line-item properties. */
function imageUrlsFromProperties(properties: unknown): string[] {
  const urls: string[] = [];
  if (Array.isArray(properties)) {
    for (const p of properties) {
      const value =
        p && typeof p === "object" && "value" in p
          ? (p as { value: unknown }).value
          : undefined;
      if (typeof value === "string" && /^https?:\/\/\S+/i.test(value.trim())) {
        urls.push(value.trim());
      }
    }
  }
  return urls;
}

export type OrderLoadState = "pending" | "printing" | "printed";

export interface OrderLoadView {
  shopifyOrderId: string;
  orderName: string;
  productTitles: string[];
  size: string;
  material: string;
  pieceCount: number;
  imageUrls: string[];
  /** Total pieces across the whole order (all sizes/beds) — multi detection. */
  orderTotal: number;
  multi: boolean;
  state: OrderLoadState;
}

export interface BedLoadView {
  bedId: string;
  workOrderNum: string;
  label: string;
  orders: OrderLoadView[];
}

/**
 * Everything the guided load screen needs: the bed's orders (each with its
 * photos, piece count, multi-piece flag, and print state). Assumes pieces have
 * already been generated for the bed.
 */
export async function getBedLoadView(
  bedId: string,
): Promise<BedLoadView | null> {
  const bed = await prisma.bed.findUnique({ where: { id: bedId } });
  if (!bed) return null;

  const pieces = await prisma.printPiece.findMany({
    where: { bedId },
    orderBy: [{ jobId: "asc" }, { pieceIndex: "asc" }],
    include: {
      job: true,
      events: {
        where: { action: LABELS_PRINTED_EVENT },
        select: { id: true },
      },
    },
  });

  interface Acc {
    shopifyOrderId: string;
    orderName: string;
    titles: Set<string>;
    size: string;
    material: string;
    imageUrls: Set<string>;
    pieceCount: number;
    anyRequested: boolean;
    anyPrinted: boolean;
  }

  const byOrder = new Map<string, Acc>();
  for (const p of pieces) {
    const key = p.job.shopifyOrderId;
    let acc = byOrder.get(key);
    if (!acc) {
      acc = {
        shopifyOrderId: key,
        orderName: p.job.orderName,
        titles: new Set(),
        size: p.job.size,
        material: p.job.material,
        imageUrls: new Set(),
        pieceCount: 0,
        anyRequested: false,
        anyPrinted: false,
      };
      byOrder.set(key, acc);
    }
    acc.pieceCount += 1;
    acc.titles.add(p.job.productTitle);
    for (const u of imageUrlsFromProperties(p.job.properties)) {
      acc.imageUrls.add(u);
    }
    if (p.status === LABELS_REQUESTED) acc.anyRequested = true;
    if (p.events.length > 0) acc.anyPrinted = true;
  }

  const orders: OrderLoadView[] = await Promise.all(
    [...byOrder.values()].map(async (acc) => {
      const scope = await getOrderScope(acc.orderName);
      const state: OrderLoadState = acc.anyRequested
        ? "printing"
        : acc.anyPrinted
          ? "printed"
          : "pending";
      return {
        shopifyOrderId: acc.shopifyOrderId,
        orderName: acc.orderName,
        productTitles: [...acc.titles],
        size: acc.size,
        material: acc.material,
        pieceCount: acc.pieceCount,
        imageUrls: [...acc.imageUrls],
        orderTotal: scope.totalPieces,
        multi: scope.multi,
        state,
      };
    }),
  );

  // Stable order: by Shopify order name.
  orders.sort((a, b) => a.orderName.localeCompare(b.orderName));

  return {
    bedId: bed.id,
    workOrderNum: bed.workOrderNum,
    label: bed.label,
    orders,
  };
}

/** Queue one order (on a bed) for the print bridge by flagging its pieces. */
export async function requestLabelsForOrder(
  bedId: string,
  shopifyOrderId: string,
): Promise<number> {
  const pieces = await prisma.printPiece.findMany({
    where: { bedId, job: { shopifyOrderId } },
    select: { id: true },
  });
  const ids = pieces.map((p) => p.id);
  if (ids.length === 0) return 0;
  await prisma.printPiece.updateMany({
    where: { id: { in: ids } },
    data: { status: LABELS_REQUESTED },
  });
  return ids.length;
}

export interface OrderLabelJob {
  bedId: string;
  workOrderNum: string;
  shopifyOrderId: string;
  orderName: string;
  pieces: {
    qrCode: string;
    orderName: string;
    size: string;
    material: string;
    pieceIndex: number;
    quantity: number;
  }[];
}

/** All orders currently waiting for the bridge, grouped by bed+order. */
export async function listOrderLabelJobs(): Promise<OrderLabelJob[]> {
  const pieces = await prisma.printPiece.findMany({
    where: { status: LABELS_REQUESTED },
    orderBy: [{ jobId: "asc" }, { pieceIndex: "asc" }],
    include: {
      job: true,
      bed: { select: { id: true, workOrderNum: true } },
    },
  });

  const byKey = new Map<string, OrderLabelJob>();
  for (const p of pieces) {
    if (!p.bed) continue;
    const key = `${p.bed.id}:${p.job.shopifyOrderId}`;
    let jobEntry = byKey.get(key);
    if (!jobEntry) {
      jobEntry = {
        bedId: p.bed.id,
        workOrderNum: p.bed.workOrderNum,
        shopifyOrderId: p.job.shopifyOrderId,
        orderName: p.job.orderName,
        pieces: [],
      };
      byKey.set(key, jobEntry);
    }
    jobEntry.pieces.push({
      qrCode: p.qrCode,
      orderName: p.job.orderName,
      size: p.job.size,
      material: p.job.material,
      pieceIndex: p.pieceIndex,
      quantity: p.job.quantity,
    });
  }

  return [...byKey.values()];
}

/**
 * Ack one order's labels as printed: clear the `labels_requested` flag back to
 * `printed` and log a `labels_printed` event (so the load screen shows it done).
 */
export async function markOrderLabeled(
  bedId: string,
  shopifyOrderId: string,
): Promise<number> {
  const pieces = await prisma.printPiece.findMany({
    where: { bedId, job: { shopifyOrderId }, status: LABELS_REQUESTED },
    select: { id: true },
  });
  const ids = pieces.map((p) => p.id);
  if (ids.length === 0) return 0;
  await prisma.$transaction([
    prisma.printPiece.updateMany({
      where: { id: { in: ids } },
      data: { status: "printed" },
    }),
    prisma.pieceEvent.createMany({
      data: ids.map((id) => ({ pieceId: id, action: LABELS_PRINTED_EVENT })),
    }),
  ]);
  return ids.length;
}
