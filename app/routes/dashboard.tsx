import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";

import { prisma } from "~/db.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction = () => [{ title: "Dashboard — Print Station" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const staff = await requireStaff(request);

  const [pendingJobs, inProductionJobs, openBeds, piecesNeedingReprint] =
    await Promise.all([
      prisma.printJob.count({ where: { status: "pending" } }),
      prisma.printJob.count({ where: { status: "in_production" } }),
      prisma.bed.count({ where: { status: "open" } }),
      prisma.printPiece.count({ where: { status: "qc_fail" } }),
    ]);

  return json({
    staff: { name: staff.name, role: staff.role },
    stats: { pendingJobs, inProductionJobs, openBeds, piecesNeedingReprint },
  });
};

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 text-sm text-gray-500">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const { staff, stats } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-full bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">Print Station</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {staff.name}{" "}
            <span className="text-gray-400">({staff.role})</span>
          </span>
          <Form method="post" action="/logout">
            <button
              type="submit"
              className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-300"
            >
              Sign out
            </button>
          </Form>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <nav className="mb-6">
          <Link
            to="/beds"
            className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Manage beds →
          </Link>
        </nav>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Link to="/beds">
            <StatCard label="Pending jobs" value={stats.pendingJobs} />
          </Link>
          <StatCard label="In production" value={stats.inProductionJobs} />
          <Link to="/beds">
            <StatCard label="Open beds" value={stats.openBeds} />
          </Link>
          <StatCard
            label="Awaiting reprint"
            value={stats.piecesNeedingReprint}
          />
        </div>
      </main>
    </div>
  );
}
