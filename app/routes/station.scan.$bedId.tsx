import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import invariant from "tiny-invariant";

import { getBed, markBedLabelsRequested } from "~/models/bed.server";
import { generatePiecesForBed, piecesForBed } from "~/models/piece.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction = () => [{ title: "Print labels — Print Station" }];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireStaff(request);
  invariant(params.bedId, "bedId is required");

  const bed = await getBed(params.bedId);
  if (!bed) throw new Response("Bed not found", { status: 404 });

  // Make sure pieces exist, then queue this bed for the print bridge.
  await generatePiecesForBed(bed.id);
  const pieces = await piecesForBed(bed.id);
  await markBedLabelsRequested(bed.id);

  const orders = new Set(pieces.map((p) => p.job.orderName));

  return json({
    workOrderNum: bed.workOrderNum,
    label: bed.label,
    pieceCount: pieces.length,
    orderCount: orders.size,
  });
};

export default function StationScan() {
  const { workOrderNum, label, pieceCount, orderCount } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-gray-50 px-6 py-16">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <div className="mb-2 text-4xl">🖨️</div>
        <h1 className="text-xl font-semibold text-gray-900">Queued to print</h1>
        <p className="mt-1 text-sm text-gray-500">
          {workOrderNum} · {label}
        </p>

        <div className="mt-5 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
          Printing <span className="font-medium">{orderCount}</span> traveler
          {orderCount === 1 ? "" : "s"} and{" "}
          <span className="font-medium">{pieceCount}</span> piece label
          {pieceCount === 1 ? "" : "s"} at this station.
        </div>

        <p className="mt-4 text-xs text-gray-400">
          The print bridge will pick these up in a few seconds. Scan again to
          reprint.
        </p>

        <Link
          to="/beds/viewer"
          className="mt-5 inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Back to queue
        </Link>
      </div>
    </div>
  );
}
