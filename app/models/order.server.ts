import { prisma } from "~/db.server";

// Order consolidation for shipping. An "order" is keyed by its Shopify order
// name (e.g. "#1039"); its pieces can be spread across multiple beds (different
// sizes/materials print on different beds), so we reunite them here.
//
// Piece lifecycle used for packing: printed → qc_pass → packed → shipped.
// We consider a piece "outstanding" until it's shipped.

export interface OrderPieceView {
  id: string;
  qrCode: string;
  size: string;
  material: string;
  pieceIndex: number;
  quantity: number;
  status: string;
  bedWorkOrder: string | null;
}

export interface OrderConsolidation {
  orderName: string;
  pieces: OrderPieceView[];
  total: number;
  packed: number;
  allPacked: boolean;
}

/** Quick counts for an order (used on the piece-scan screen). */
export async function orderPieceSummary(
  orderName: string,
): Promise<{ total: number; packed: number }> {
  const pieces = await prisma.printPiece.findMany({
    where: { job: { orderName }, status: { not: "shipped" } },
    select: { status: true },
  });
  return {
    total: pieces.length,
    packed: pieces.filter((p) => p.status === "packed").length,
  };
}

/** Full consolidation view for one order. Null if it has no live pieces. */
export async function getOrderConsolidation(
  orderName: string,
): Promise<OrderConsolidation | null> {
  const pieces = await prisma.printPiece.findMany({
    where: { job: { orderName }, status: { not: "shipped" } },
    include: {
      job: true,
      bed: { select: { workOrderNum: true } },
    },
    orderBy: [{ jobId: "asc" }, { pieceIndex: "asc" }],
  });
  if (pieces.length === 0) return null;

  const packed = pieces.filter((p) => p.status === "packed").length;
  return {
    orderName,
    total: pieces.length,
    packed,
    allPacked: packed === pieces.length,
    pieces: pieces.map((p) => ({
      id: p.id,
      qrCode: p.qrCode,
      size: p.job.size,
      material: p.job.material,
      pieceIndex: p.pieceIndex,
      quantity: p.job.quantity,
      status: p.status,
      bedWorkOrder: p.bed?.workOrderNum ?? null,
    })),
  };
}

export interface ShippingOrder {
  orderName: string;
  total: number;
  packed: number;
  allPacked: boolean;
}

/** All orders with outstanding (unshipped) pieces, with packing progress. */
export async function listOrdersForShipping(): Promise<ShippingOrder[]> {
  const pieces = await prisma.printPiece.findMany({
    where: { status: { not: "shipped" } },
    include: { job: { select: { orderName: true } } },
  });

  const map = new Map<string, ShippingOrder>();
  for (const p of pieces) {
    const key = p.job.orderName;
    const entry =
      map.get(key) ?? { orderName: key, total: 0, packed: 0, allPacked: false };
    entry.total += 1;
    if (p.status === "packed") entry.packed += 1;
    map.set(key, entry);
  }
  return [...map.values()]
    .map((o) => ({ ...o, allPacked: o.total > 0 && o.packed === o.total }))
    .sort((a, b) => a.orderName.localeCompare(b.orderName));
}

export async function markPiecePacked(qrCode: string, staffId: string) {
  const piece = await prisma.printPiece.findUnique({ where: { qrCode } });
  if (!piece) throw new Error("Piece not found");
  await prisma.$transaction([
    prisma.printPiece.update({
      where: { id: piece.id },
      data: { status: "packed" },
    }),
    prisma.pieceEvent.create({
      data: { pieceId: piece.id, staffId, action: "packed" },
    }),
  ]);
  return piece;
}

/** Mark all of an order's packed pieces as shipped. */
export async function markOrderShipped(orderName: string, staffId: string) {
  const pieces = await prisma.printPiece.findMany({
    where: { job: { orderName }, status: "packed" },
    select: { id: true },
  });
  const ids = pieces.map((p) => p.id);
  await prisma.$transaction([
    prisma.printPiece.updateMany({
      where: { id: { in: ids } },
      data: { status: "shipped" },
    }),
    prisma.pieceEvent.createMany({
      data: ids.map((id) => ({ pieceId: id, staffId, action: "shipped" })),
    }),
  ]);
  return ids.length;
}
