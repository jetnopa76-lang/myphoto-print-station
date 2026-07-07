import type { PrintJob, PrintPiece } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { prisma } from "~/db.server";

export type QcResult = "qc_pass" | "qc_fail";

/** Record a QC pass/fail on a piece and log the event. */
export async function recordQc(
  qrCode: string,
  staffId: string,
  result: QcResult,
  note?: string,
): Promise<PrintPiece> {
  const piece = await prisma.printPiece.findUnique({ where: { qrCode } });
  if (!piece) throw new Error("Piece not found");

  const [updated] = await prisma.$transaction([
    prisma.printPiece.update({
      where: { id: piece.id },
      data: { status: result },
    }),
    prisma.pieceEvent.create({
      data: { pieceId: piece.id, staffId, action: result, note },
    }),
  ]);
  return updated;
}

/**
 * Request a reprint for a failed piece. Creates a fresh pending PrintJob
 * (quantity 1) cloned from the original order line so the reprint flows
 * back through the Bed Maker, marks the original piece "reprinting", and
 * logs events on both the piece and the new job.
 */
export async function requestReprint(
  qrCode: string,
  staffId: string,
  reason?: string,
): Promise<PrintJob> {
  const piece = await prisma.printPiece.findUnique({
    where: { qrCode },
    include: { job: true },
  });
  if (!piece) throw new Error("Piece not found");
  const job = piece.job;
  const reasonSuffix = reason ? ` — ${reason}` : "";

  return prisma.$transaction(async (tx) => {
    const reprint = await tx.printJob.create({
      data: {
        shopifyOrderId: job.shopifyOrderId,
        orderName: job.orderName,
        lineItemId: job.lineItemId,
        lineItemKey: `${job.lineItemKey}-reprint-${Date.now()}`,
        sku: job.sku,
        productHandle: job.productHandle,
        productTitle: `${job.productTitle} (reprint)`,
        variantTitle: job.variantTitle,
        size: job.size,
        material: job.material,
        quantity: 1,
        properties: (job.properties ?? []) as Prisma.InputJsonValue,
        frameCount: job.frameCount,
        status: "pending",
        events: {
          create: {
            staffId,
            action: "reprint_requested",
            note: `Reprint of ${qrCode} (${job.orderName})${reasonSuffix}`,
          },
        },
      },
    });

    await tx.printPiece.update({
      where: { id: piece.id },
      data: { status: "reprinting", reprintOf: qrCode },
    });
    await tx.pieceEvent.create({
      data: {
        pieceId: piece.id,
        staffId,
        action: "reprint_requested",
        note: `Reprint queued as a new work order${reasonSuffix}`,
      },
    });

    return reprint;
  });
}
