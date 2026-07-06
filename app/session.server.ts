import { createCookieSessionStorage, redirect } from "@remix-run/node";
import invariant from "tiny-invariant";

import type { Staff } from "@prisma/client";
import { prisma } from "~/db.server";

invariant(process.env.SESSION_SECRET, "SESSION_SECRET must be set");

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [process.env.SESSION_SECRET],
    secure: process.env.NODE_ENV === "production",
  },
});

const STAFF_SESSION_KEY = "staffId";

export async function getSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  return sessionStorage.getSession(cookie);
}

export async function getStaffId(
  request: Request,
): Promise<Staff["id"] | undefined> {
  const session = await getSession(request);
  const staffId = session.get(STAFF_SESSION_KEY);
  return staffId;
}

export async function getStaff(request: Request): Promise<Staff | null> {
  const staffId = await getStaffId(request);
  if (!staffId) return null;
  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
  return staff;
}

export async function requireStaff(request: Request): Promise<Staff> {
  const staff = await getStaff(request);
  if (!staff || !staff.active) {
    throw redirect("/login");
  }
  return staff;
}

export async function createStaffSession({
  request,
  staffId,
  redirectTo,
}: {
  request: Request;
  staffId: string;
  redirectTo: string;
}) {
  const session = await getSession(request);
  session.set(STAFF_SESSION_KEY, staffId);
  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await sessionStorage.commitSession(session, {
        maxAge: 60 * 60 * 24 * 7, // 7 days
      }),
    },
  });
}

export async function logout(request: Request) {
  const session = await getSession(request);
  return redirect("/login", {
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session),
    },
  });
}