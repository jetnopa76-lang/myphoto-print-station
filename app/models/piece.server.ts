import crypto from "node:crypto";

import type { Bed, PrintJob, PrintPiece } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { prisma } from "~/db.server";

export type { PrintPiece };

/** Generate a unique-ish QR code value like "PS-A7B2C9D1E3". */
export function newQrCode(): string {
  return "PS-" + crypto.randomBytes(5).toString("hex").toUpperCase();
}

export async function countPiecesForBed(bedId: string): Promise<number> {
  return prisma.printPiece.count({ where: { bedId } });
}

/**
 * Create one PrintPiece per physical piece in a bed (a job with quantity N
 * yields N pieces, indexed 1..N), each with a unique QR code. Idempotent:
 * if the bed already has pieces, returns them unchanged rather than
 * duplicating. Retries individual inserts once on a QR-code collision.
 */
export async function generatePiecesForBed(
  bedId: string,
): Promise<PrintPiece[]> {
  const existing = await prisma.printPiece.findMany({ where: { bedId } });
  if (existing.length > 0) return existing;

  const bed = await prisma.bed.findUnique({
    where: { id: bedId },
    include: { items: { include: { job: true } } },
  });
  if (!bed) throw new Error("Bed not found");

  const created: PrintPiece[] = [];
  for (const item of bed.items) {
    for (let index = 1; index <= item.quantity; index++) {
      created.push(await createPieceWithRetry(bed, item.job, index));
    }
  }
  return created;
}

async function createPieceWithRetry(
  bed: Bed,
  job: PrintJob,
  pieceIndex: number,
  attempt = 0,
): Promise<PrintPiece> {
  try {
    return await prisma.printPiece.create({
      data: {
        qrCode: newQrCode(),
        jobId: job.id,
        bedId: bed.id,
        pieceIndex,
        status: "printed",
      },
    });
  } catch (error) {
    if (
      attempt < 3 &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return createPieceWithRetry(bed, job, pieceIndex, attempt + 1);
    }
    throw error;
  }
}

export type PieceWithContext = PrintPiece & {
  job: PrintJob;
  bed: Bed | null;
};

/** Resolve a scanned QR code to its piece, with the order + bed attached. */
export async function getPieceByQr(
  qrCode: string,
): Promise<PieceWithContext | null> {
  return prisma.printPiece.findUnique({
    where: { qrCode },
    include: { job: true, bed: true },
  });
}

export async function piecesForBed(bedId: string): Promise<
  (PrintPiece & { job: PrintJob })[]
> {
  return prisma.printPiece.findMany({
    where: { bedId },
    orderBy: [{ jobId: "asc" }, { pieceIndex: "asc" }],
    include: { job: true },
  });
}
