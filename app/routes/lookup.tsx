import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";

import { AppShell } from "~/components/app-shell";
import { prisma } from "~/db.server";
import { getPieceByQr } from "~/models/piece.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction = () => [
  { title: "WO Lookup — Print Station" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const staff = await requireStaff(request);
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return json({ staffName: staff.name, q, beds: [], jobs: [], piece: null });
  }

  const [beds, jobs, piece] = await Promise.all([
    prisma.bed.findMany({
      where: { workOrderNum: { contains: q, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.printJob.findMany({
      where: {
        OR: [
          { orderName: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { productTitle: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    /^ps-/i.test(q) ? getPieceByQr(q.toUpperCase()) : Promise.resolve(null),
  ]);

  return json({ staffName: staff.name, q, beds, jobs, piece });
};

export default function Lookup() {
  const { staffName, q, beds, jobs, piece } = useLoaderData<typeof loader>();
  const hasResults = beds.length > 0 || jobs.length > 0 || piece;

  return (
    <AppShell active="lookup" staffName={staffName}>
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h1 className="mb-4 text-base font-medium text-gray-900">
          Work order lookup
        </h1>

        <Form method="get" className="mb-5 flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Work order, order #, SKU, or QR code (PS-…)"
            className="h-9 flex-1 rounded-md border border-gray-300 px-3 text-sm"
          />
          <button
            type="submit"
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            Search
          </button>
        </Form>

        {q && !hasResults ? (
          <p className="text-sm text-gray-400">No matches for “{q}”.</p>
        ) : null}

        {piece ? (
          <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="mb-1 font-mono text-xs text-green-700">
              {piece.qrCode}
            </div>
            <div className="font-medium text-gray-900">
              {piece.job.orderName} — {piece.job.productTitle}
            </div>
            <Link
              to={`/scan/${piece.qrCode}`}
              className="mt-2 inline-block text-sm text-teal-700 hover:underline"
            >
              Open piece →
            </Link>
          </div>
        ) : null}

        {beds.length > 0 ? (
          <section className="mb-5">
            <h2 className="mb-2 text-sm font-medium text-gray-500">Beds</h2>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {beds.map((bed) => (
                <li key={bed.id}>
                  <Link
                    to={`/beds/${bed.id}`}
                    className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50"
                  >
                    <span className="font-medium text-gray-900">
                      {bed.workOrderNum}
                    </span>
                    <span className="text-gray-500">{bed.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {jobs.length > 0 ? (
          <section>
            <h2 className="mb-2 text-sm font-medium text-gray-500">
              Work orders
            </h2>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex items-center justify-between px-4 py-2.5"
                >
                  <span>
                    <span className="font-medium text-gray-900">
                      {job.orderName}
                    </span>
                    <span className="ml-2 text-gray-500">
                      {job.productTitle}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    {job.size} · {job.material} · ×{job.quantity}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
