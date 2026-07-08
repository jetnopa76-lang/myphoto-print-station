import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { AppShell } from "~/components/app-shell";
import { capacityKey, defaultCapacity } from "~/lib/bed-capacity";
import { getCapacityMap } from "~/lib/bedster.server";
import { listActiveBeds } from "~/models/bed.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction = () => [
  { title: "Bed Viewer — Print Station" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const staff = await requireStaff(request);
  const [beds, capacities] = await Promise.all([
    listActiveBeds(),
    getCapacityMap(),
  ]);
  return json({ staffName: staff.name, beds, capacities });
};

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-gray-100 text-gray-700" },
  sent_to_bedster: { label: "At Bedster", cls: "bg-amber-100 text-amber-800" },
  imposed: { label: "Ready to claim", cls: "bg-green-100 text-green-800" },
  printing: { label: "Printing", cls: "bg-blue-100 text-blue-800" },
  labels_requested: {
    label: "Labels queued",
    cls: "bg-purple-100 text-purple-800",
  },
  labeled: { label: "Labeled", cls: "bg-teal-100 text-teal-800" },
};

export default function BedViewer() {
  const { staffName, beds, capacities } = useLoaderData<typeof loader>();

  return (
    <AppShell active="viewer" staffName={staffName}>
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h1 className="mb-4 text-base font-medium text-gray-900">Bed queue</h1>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500">
                <th className="px-3 py-2.5 font-medium">Work Order</th>
                <th className="px-3 py-2.5 font-medium">Label</th>
                <th className="px-3 py-2.5 font-medium">Size</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="w-36 px-3 py-2.5 font-medium">Filled</th>
                <th className="px-3 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {beds.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-gray-400"
                  >
                    No beds in the queue.
                  </td>
                </tr>
              ) : (
                beds.map((bed) => {
                  const total = bed.items.reduce(
                    (sum, it) => sum + it.quantity,
                    0,
                  );
                  const cap =
                    capacities[capacityKey(bed.size)] ??
                    defaultCapacity(bed.size);
                  const pct = cap
                    ? Math.min(100, Math.round((total / cap) * 100))
                    : 0;
                  const status = STATUS[bed.status] ?? {
                    label: bed.status,
                    cls: "bg-gray-100 text-gray-700",
                  };
                  return (
                    <tr
                      key={bed.id}
                      className="border-t border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          to={`/beds/${bed.id}`}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {bed.workOrderNum}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{bed.label}</td>
                      <td className="px-3 py-2.5 text-gray-600">{bed.size}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${status.cls}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {cap === null ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-teal-100">
                              <div
                                className="h-full rounded-full bg-teal-600"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="whitespace-nowrap text-xs text-gray-400">
                              {total}/{cap}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {bed._count.pieces > 0 ? (
                            <a
                              href={`/beds/${bed.id}/manifest`}
                              className="rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700"
                            >
                              Ticket
                            </a>
                          ) : null}
                          <Link
                            to={`/beds/${bed.id}`}
                            className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Open
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
