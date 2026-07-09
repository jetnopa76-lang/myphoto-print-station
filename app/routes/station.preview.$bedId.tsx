import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import invariant from "tiny-invariant";

import { AppShell } from "~/components/app-shell";
import { requestOrigin } from "~/lib/bridge.server";
import type { LabelPiece } from "~/lib/zpl.server";
import { orderLabelsZpl, pieceLabelZpl } from "~/lib/zpl.server";
import { getBed } from "~/models/bed.server";
import { getOrderScope } from "~/models/order.server";
import { generatePiecesForBed, piecesForBed } from "~/models/piece.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `Preview — ${data.workOrderNum}` : "Preview" },
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const staff = await requireStaff(request);
  invariant(params.bedId, "bedId is required");
  const bed = await getBed(params.bedId);
  if (!bed) throw new Response("Bed not found", { status: 404 });

  await generatePiecesForBed(bed.id);
  const pieces = await piecesForBed(bed.id);
  const origin = requestOrigin(request);

  const byOrder = new Map<string, typeof pieces>();
  for (const p of pieces) {
    const key = p.job.shopifyOrderId;
    const list = byOrder.get(key) ?? [];
    list.push(p);
    byOrder.set(key, list);
  }

  const orders = await Promise.all(
    [...byOrder.entries()].map(async ([shopifyOrderId, ps]) => {
      const orderName = ps[0].job.orderName;
      const scope = await getOrderScope(orderName);
      const labelPieces: LabelPiece[] = ps.map((p) => ({
        qrCode: p.qrCode,
        orderName: p.job.orderName,
        size: p.job.size,
        material: p.job.material,
        pieceIndex: p.pieceIndex,
        pieceCount: p.job.quantity,
        orderTotal: scope.totalPieces,
      }));
      return {
        orderName,
        pieceCount: ps.length,
        firstLabelZpl: pieceLabelZpl(labelPieces[0], origin),
        allZpl: orderLabelsZpl(labelPieces, origin),
        travelerUrl: `${origin}/station/traveler/${bed.id}?order=${encodeURIComponent(shopifyOrderId)}`,
      };
    }),
  );

  return json({
    staffName: staff.name,
    bedId: bed.id,
    workOrderNum: bed.workOrderNum,
    label: bed.label,
    orders,
  });
};

function labelaryImg(zpl: string): string {
  // Renders a 2x1" label at 203dpi (8dpmm), first label only.
  return `https://api.labelary.com/v1/printers/8dpmm/labels/2x1/0/${encodeURIComponent(zpl)}`;
}

export default function Preview() {
  const { staffName, workOrderNum, label, orders } =
    useLoaderData<typeof loader>();

  return (
    <AppShell active="viewer" staffName={staffName}>
      <div className="mb-4 flex items-center gap-3">
        <Link to="/beds/viewer" className="text-sm text-teal-700 hover:underline">
          ← Queue
        </Link>
        <h1 className="text-lg font-semibold text-gray-900">
          Print preview — {workOrderNum}
        </h1>
      </div>
      <p className="mb-5 text-sm text-gray-500">
        {label} · what will print when the work-order QR is scanned. One label
        batch + one traveler per order.
      </p>

      <div className="space-y-6">
        {orders.map((o) => (
          <div
            key={o.orderName}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="mb-3 font-medium text-gray-900">
              {o.orderName}{" "}
              <span className="text-sm font-normal text-gray-500">
                · {o.pieceCount} label{o.pieceCount === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium uppercase text-gray-400">
                  Zebra label (first piece)
                </div>
                <img
                  src={labelaryImg(o.firstLabelZpl)}
                  alt={`Label preview for ${o.orderName}`}
                  className="rounded border border-gray-200"
                  style={{ width: 300 }}
                />
              </div>

              <div>
                <div className="mb-2 text-xs font-medium uppercase text-gray-400">
                  Star traveler
                </div>
                <iframe
                  title={`Traveler ${o.orderName}`}
                  src={o.travelerUrl}
                  className="h-80 w-full rounded border border-gray-200"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
