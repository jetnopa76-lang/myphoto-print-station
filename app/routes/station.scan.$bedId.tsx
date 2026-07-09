import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import invariant from "tiny-invariant";

import { getBed } from "~/models/bed.server";
import { generatePiecesForBed } from "~/models/piece.server";
import {
  getBedLoadView,
  requestLabelsForOrder,
} from "~/models/station.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `Load ${data.view.workOrderNum}` : "Load bed" },
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireStaff(request);
  invariant(params.bedId, "bedId is required");

  const bed = await getBed(params.bedId);
  if (!bed) throw new Response("Bed not found", { status: 404 });

  // Make sure pieces exist so we have QR codes + per-order grouping.
  await generatePiecesForBed(bed.id);
  const view = await getBedLoadView(bed.id);
  if (!view) throw new Response("Bed not found", { status: 404 });

  return json({ view });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await requireStaff(request);
  invariant(params.bedId, "bedId is required");

  const form = await request.formData();
  const shopifyOrderId = String(form.get("shopifyOrderId") ?? "");
  if (!shopifyOrderId) {
    return json({ ok: false, error: "Missing order" }, { status: 400 });
  }

  const count = await requestLabelsForOrder(params.bedId, shopifyOrderId);
  return json({ ok: true, shopifyOrderId, count });
};

type OrderView = ReturnType<typeof useLoaderData<typeof loader>>["view"]["orders"][number];

function Badge({ state }: { state: OrderView["state"] }) {
  const map = {
    pending: { text: "Not printed", cls: "bg-gray-100 text-gray-600" },
    printing: { text: "Printing…", cls: "bg-amber-100 text-amber-800" },
    printed: { text: "✓ Printed", cls: "bg-green-100 text-green-700" },
  } as const;
  const s = map[state];
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.text}
    </span>
  );
}

export default function StationLoad() {
  const { view } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  // Start at the first order that hasn't printed yet.
  const firstPending = Math.max(
    0,
    view.orders.findIndex((o) => o.state === "pending"),
  );
  const [index, setIndex] = useState(
    firstPending === -1 ? 0 : firstPending,
  );

  // When an approve succeeds, advance to the next order.
  const submitting = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setIndex((i) => Math.min(i + 1, view.orders.length));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  const total = view.orders.length;
  const done = index >= total;
  const order = done ? null : view.orders[index];

  return (
    <div className="min-h-full bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <Link to="/beds/viewer" className="text-sm text-teal-700 hover:underline">
            ← Queue
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">
            Load {view.workOrderNum}
          </h1>
          <span className="text-sm text-gray-500">{view.label}</span>
        </div>
        <div className="text-sm text-gray-500">
          {Math.min(index + (done ? 0 : 1), total)} / {total} orders
        </div>
      </header>

      {/* Progress dots */}
      <div className="flex flex-wrap gap-2 border-b border-gray-100 bg-white px-6 py-3">
        {view.orders.map((o, i) => (
          <button
            key={o.shopifyOrderId}
            onClick={() => setIndex(i)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              i === index && !done
                ? "bg-teal-600 text-white"
                : o.state === "printed"
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
            }`}
            title={o.orderName}
          >
            {o.orderName}
          </button>
        ))}
      </div>

      <main className="mx-auto max-w-2xl px-6 py-8">
        {done ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
            <div className="mb-2 text-4xl">✓</div>
            <h2 className="text-xl font-semibold text-green-800">
              All orders on this bed are printed
            </h2>
            <p className="mt-1 text-sm text-green-700">
              {total} order{total === 1 ? "" : "s"} · {view.label}
            </p>
            <Link
              to="/beds/viewer"
              className="mt-5 inline-block rounded-md border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-50"
            >
              Back to queue
            </Link>
          </div>
        ) : order ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xl font-semibold text-gray-900">
                  {order.orderName}
                </div>
                <div className="text-sm text-gray-500">
                  {order.size} {order.material} · {order.pieceCount} piece
                  {order.pieceCount === 1 ? "" : "s"}
                </div>
              </div>
              <Badge state={order.state} />
            </div>

            {order.multi ? (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                ⚑ Multi-piece order — {order.orderTotal} pieces total across
                sizes. Pieces will be flagged to hold for consolidation.
              </div>
            ) : null}

            {/* Customer photos to place on the bed, in order */}
            {order.imageUrls.length > 0 ? (
              <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {order.imageUrls.map((url, i) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-lg border border-gray-200"
                  >
                    <img
                      src={url}
                      alt={`${order.orderName} photo ${i + 1}`}
                      className="h-40 w-full bg-gray-50 object-contain transition group-hover:opacity-90"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            ) : (
              <div className="mb-5 rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-400">
                No preview image on this order — check the print file.
              </div>
            )}

            {order.productTitles.length > 0 ? (
              <p className="mb-5 text-xs text-gray-400">
                {order.productTitles.join(" · ")}
              </p>
            ) : null}

            <fetcher.Form method="post">
              <input
                type="hidden"
                name="shopifyOrderId"
                value={order.shopifyOrderId}
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-teal-600 px-4 py-3 text-base font-semibold text-white hover:bg-teal-700 disabled:bg-gray-300"
                >
                  {submitting
                    ? "Sending to printer…"
                    : order.state === "printed"
                      ? "Reprint & continue"
                      : "Approve & print"}
                </button>
                {index < total - 1 ? (
                  <button
                    type="button"
                    onClick={() => setIndex((i) => Math.min(i + 1, total))}
                    className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Skip
                  </button>
                ) : null}
              </div>
            </fetcher.Form>

            <p className="mt-3 text-center text-xs text-gray-400">
              Prints {order.pieceCount} label
              {order.pieceCount === 1 ? "" : "s"} (Zebra) + 1 traveler (Star),
              then moves to the next order.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
