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

export type StaffRef = Pick<Staff, "id" | "name">;
