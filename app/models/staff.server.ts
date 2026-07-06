import bcrypt from "bcryptjs";

import type { Staff } from "@prisma/client";
import { prisma } from "~/db.server";

export type { Staff };

/**
 * Verify a staff member's PIN. Returns the Staff record on success,
 * or null if the name is unknown, the account is inactive, or the PIN
 * is wrong.
 */
export async function verifyStaffLogin(
  name: string,
  pin: string,
): Promise<Staff | null> {
  const staff = await prisma.staff.findUnique({ where: { name } });
  if (!staff || !staff.active) return null;

  const valid = await bcrypt.compare(pin, staff.pinHash);
  if (!valid) return null;

  return staff;
}

export async function getStaffById(id: Staff["id"]): Promise<Staff | null> {
  return prisma.staff.findUnique({ where: { id } });
}

export async function listStaff(): Promise<Staff[]> {
  return prisma.staff.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
}
