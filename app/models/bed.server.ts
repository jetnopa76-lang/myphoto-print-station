import type { Bed, BedItem, PrintJob, Staff } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { prisma } from "~/db.server";

export type { Bed, BedItem };

export interface JobGroup {
  size: string;
  material: string;
  label: string;
  ready: boolean; // false when size/material is "unknown" — can't impose yet
  jobs: PrintJob[];
  totalQuantity: number;
}

/** Build a human label for a bed/group, e.g. "5x7 Acrylic Block". */
export function bedLabel(size: string, material: string): string {
  return `${size} ${material}`.trim();
}

/**
 * Group all pending jobs by (size, material). Groups whose size or material
 * is still "unknown" are returned with ready=false so the UI can flag them
 * for manual attention rather than imposing garbage.
 */
export async function groupPendingJobs(): Promise<JobGroup[]> {
  const jobs = await prisma.printJob.findMany({
    where: { status: "pending" },
    orderBy: [{ size: "asc" }, { material: "asc" }, { createdAt: "asc" }],
  });

  const groups = new Map<string, JobGroup>();
  for (const job of jobs) {
    const key = `${job.size}|||${job.material}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        size: job.size,
        material: job.material,
        label: bedLabel(job.size, job.material),
        ready: job.size !== "unknown" && job.material !== "unknown",
        jobs: [],
        totalQuantity: 0,
      };
      groups.set(key, group);
    }
    group.jobs.push(job);
    group.totalQuantity += job.quantity;
  }

  return [...groups.values()];
}

/**
 * Generate the next work-order number for the current year, e.g.
 * "WO-2026-0142". Must run inside a transaction so the count is consistent;
 * uniqueness is still enforced by the DB, and callers retry on collision.
 */
async function nextWorkOrderNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const year = new Date().getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const countThisYear = await tx.bed.count({
    where: { createdAt: { gte: startOfYear } },
  });
  return `WO-${year}-${String(countThisYear + 1).padStart(4, "0")}`;
}

export class BedCreationError extends Error {}

export interface CreateBedInput {
  size: string;
  material: string;
  jobIds: string[];
  staffId?: string;
}

/**
 * Create a Bed from a set of pending jobs that share the same size+material.
 * Transactional: creates the Bed + BedItems, flips each job to "in_bed", and
 * logs a "batched" event per job. Retries once on a work-order-number
 * collision (unique constraint).
 */
export async function createBedFromJobs(
  input: CreateBedInput,
): Promise<Bed & { items: (BedItem & { job: PrintJob })[] }> {
  const { size, material, jobIds, staffId } = input;

  if (jobIds.length === 0) {
    throw new BedCreationError("Select at least one job.");
  }
  if (size === "unknown" || material === "unknown") {
    throw new BedCreationError(
      "Cannot create a bed for unknown size or material.",
    );
  }

  const attempt = async () =>
    prisma.$transaction(async (tx) => {
      const jobs = await tx.printJob.findMany({
        where: { id: { in: jobIds } },
      });

      if (jobs.length !== jobIds.length) {
        throw new BedCreationError("One or more jobs no longer exist.");
      }
      for (const job of jobs) {
        if (job.status !== "pending") {
          throw new BedCreationError(
            `Job ${job.orderName} is no longer pending (status: ${job.status}).`,
          );
        }
        if (job.size !== size || job.material !== material) {
          throw new BedCreationError(
            `Job ${job.orderName} does not match ${size} / ${material}.`,
          );
        }
      }

      const workOrderNum = await nextWorkOrderNumber(tx);

      const bed = await tx.bed.create({
        data: {
          workOrderNum,
          label: bedLabel(size, material),
          size,
          material,
          status: "open",
          createdById: staffId,
          items: {
            create: jobs.map((job) => ({
              jobId: job.id,
              quantity: job.quantity,
            })),
          },
        },
        include: { items: { include: { job: true } } },
      });

      await tx.printJob.updateMany({
        where: { id: { in: jobIds } },
        data: { status: "in_bed" },
      });

      await tx.printJobEvent.createMany({
        data: jobs.map((job) => ({
          jobId: job.id,
          staffId,
          action: "batched",
          note: `Added to bed ${workOrderNum}`,
        })),
      });

      return bed;
    });

  try {
    return await attempt();
  } catch (error) {
    // Retry once if two beds raced for the same work-order number.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return attempt();
    }
    throw error;
  }
}

/**
 * Create a bed from a set of selected job ids. Derives size+material from
 * the selection and requires they all match (a bed is one size + material).
 */
export async function createBedFromSelection(
  jobIds: string[],
  staffId?: string,
) {
  if (jobIds.length === 0) {
    throw new BedCreationError("Select at least one work order.");
  }

  const jobs = await prisma.printJob.findMany({
    where: { id: { in: jobIds } },
    select: { size: true, material: true },
  });
  if (jobs.length === 0) {
    throw new BedCreationError("No matching work orders found.");
  }

  const { size, material } = jobs[0];
  const uniform = jobs.every(
    (j) => j.size === size && j.material === material,
  );
  if (!uniform) {
    throw new BedCreationError(
      "All selected work orders must be the same size and material.",
    );
  }

  return createBedFromJobs({ size, material, jobIds, staffId });
}

export async function listBeds(status?: string) {
  return prisma.bed.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true, pieces: true } } },
  });
}

export async function getBed(id: string) {
  return prisma.bed.findUnique({
    where: { id },
    include: {
      items: { include: { job: true } },
      createdBy: { select: { name: true } },
    },
  });
}

/** Beds still moving through the pipeline (not printed or canceled). */
export async function listActiveBeds() {
  return prisma.bed.findMany({
    where: {
      status: {
        in: [
          "open",
          "sent_to_bedster",
          "imposed",
          "printing",
          "labels_requested",
          "labeled",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { items: true, pieces: true } },
      items: { select: { quantity: true } },
    },
  });
}

// ─────────────────────────────────────────────────────
// Label printing queue (no separate table — the bed status is the signal).
// Scanning the work-order QR sets "labels_requested"; the local print bridge
// polls for those, prints, and acks back to "labeled".
// ─────────────────────────────────────────────────────

export async function markBedLabelsRequested(bedId: string): Promise<Bed> {
  return prisma.bed.update({
    where: { id: bedId },
    data: { status: "labels_requested" },
  });
}

export async function markBedLabeled(bedId: string): Promise<Bed> {
  return prisma.bed.update({
    where: { id: bedId },
    data: { status: "labeled" },
  });
}

/** Beds whose work-order QR was scanned and are waiting for the bridge. */
export async function listBedsNeedingLabels() {
  return prisma.bed.findMany({
    where: { status: "labels_requested" },
    orderBy: { createdAt: "asc" },
    include: { pieces: { include: { job: true } } },
  });
}

/** A bed's pieces for one order, with job details (for labels + traveler). */
export async function bedPiecesForOrder(bedId: string, shopifyOrderId: string) {
  return prisma.printPiece.findMany({
    where: { bedId, job: { shopifyOrderId } },
    orderBy: [{ jobId: "asc" }, { pieceIndex: "asc" }],
    include: { job: true },
  });
}

export async function getBedByWorkOrder(workOrderNum: string) {
  return prisma.bed.findUnique({
    where: { workOrderNum },
    include: { items: { include: { job: true } } },
  });
}

/** Mark a bed as submitted to Bedster for imposition. */
export async function markBedSent(bedId: string): Promise<Bed> {
  return prisma.bed.update({
    where: { id: bedId },
    data: { status: "sent_to_bedster", sentAt: new Date() },
  });
}

/**
 * Record Bedster's imposition callback: store the finished print-file URL
 * and move the bed into the queue as `imposed`. A non-"imposed" status
 * (e.g. "failed") is stored as-is for manual attention.
 */
export async function markBedImposed(
  workOrderNum: string,
  printFileUrl: string | undefined,
  status: string,
): Promise<Bed | null> {
  const bed = await prisma.bed.findUnique({ where: { workOrderNum } });
  if (!bed) return null;

  return prisma.bed.update({
    where: { id: bed.id },
    data: {
      status: status === "imposed" ? "imposed" : status,
      bedsterUrl: printFileUrl ?? bed.bedsterUrl,
      imposedAt: status === "imposed" ? new Date() : bed.imposedAt,
    },
  });
}

/**
 * An operator claims an imposed bed to print it. Moves it to `printing`
 * and logs who claimed it via a job event on each item.
 */
export async function claimBed(
  bedId: string,
  staffId: string,
  staffName: string,
): Promise<Bed> {
  return prisma.$transaction(async (tx) => {
    const items = await tx.bedItem.findMany({ where: { bedId } });
    await tx.printJobEvent.createMany({
      data: items.map((item) => ({
        jobId: item.jobId,
        staffId,
        action: "claimed",
        note: `Claimed for printing by ${staffName}`,
      })),
    });
    return tx.bed.update({
      where: { id: bedId },
      data: { status: "printing" },
    });
  });
}

export type StaffRef = Pick<Staff, "id" | "name">;
