import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import invariant from "tiny-invariant";

import { markPiecePacked, orderPieceSummary } from "~/models/order.server";
import { getPieceByQr } from "~/models/piece.server";
import { recordQc, requestReprint } from "~/models/qc.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction = () => [{ title: "Scan — Print Station" }];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireStaff(request);
  invariant(params.code, "code is required");
  const piece = await getPieceByQr(params.code);
  const order = piece
    ? await orderPieceSummary(piece.job.orderName)
    : null;
  return json({ code: params.code, piece, order });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const staff = await requireStaff(request);
  invariant(params.code, "code is required");

  const intent = (await request.formData()).get("intent");

  if (intent === "qc_pass") {
    await recordQc(params.code, staff.id, "qc_pass");
    return json({ ok: true, message: "Marked QC pass." });
  }
  if (intent === "qc_fail") {
    await recordQc(params.code, staff.id, "qc_fail");
    return json({ ok: true, message: "Marked QC fail. Reprint available." });
  }
  if (intent === "reprint") {
    const reprint = await requestReprint(params.code, staff.id);
    return json({
      ok: true,
      message: `Reprint queued as a new work order for ${reprint.orderName}.`,
    });
  }
  if (intent === "pack") {
    await markPiecePacked(params.code, staff.id);
    return json({ ok: true, message: "Marked packed." });
  }
  return json({ ok: true });
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-gray-100 py-2 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

export default function Scan() {
  const { code, piece, order } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const message = (actionData as { message?: string } | undefined)?.message;
  const multi = order ? order.total > 1 : false;

  return (
    <div className="min-h-full bg-gray-50">
      <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-6 py-4">
        <Link to="/lookup" className="text-sm text-teal-700 hover:underline">
          ← Lookup
        </Link>
        <h1 className="text-xl font-semibold text-gray-900">Scan result</h1>
      </header>

      <main className="mx-auto max-w-md px-6 py-8">
        {message ? (
          <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
            {message}
          </div>
        ) : null}

        {!piece ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-center">
            <p className="font-medium text-red-800">No piece found</p>
            <p className="mt-1 text-sm text-red-600">
              Code <span className="font-mono">{code}</span> isn&apos;t in the
              system.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-sm text-gray-500">
                {piece.qrCode}
              </span>
              <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                {piece.status}
              </span>
            </div>

            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              {piece.job.orderName} — {piece.job.productTitle}
            </h2>

            <Row label="Size" value={piece.job.size} />
            <Row label="Material" value={piece.job.material} />
            <Row
              label="Piece"
              value={`#${piece.pieceIndex} of ${piece.job.quantity}`}
            />
            <Row label="SKU" value={piece.job.sku || "—"} />
            {piece.bed ? (
              <Row label="Bed" value={piece.bed.workOrderNum} />
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Form method="post">
                <input type="hidden" name="intent" value="qc_pass" />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700"
                >
                  QC pass
                </button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="qc_fail" />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-red-600 px-4 py-3 text-sm font-medium text-white hover:bg-red-700"
                >
                  QC fail
                </button>
              </Form>
            </div>

            {piece.status === "qc_fail" ? (
              <Form method="post" className="mt-3">
                <input type="hidden" name="intent" value="reprint" />
                <button
                  type="submit"
                  className="w-full rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 hover:bg-amber-100"
                >
                  Request reprint
                </button>
              </Form>
            ) : null}

            {/* Consolidation guidance for the packer */}
            {order ? (
              multi ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="font-medium">
                    Part of {piece.job.orderName}
                  </div>
                  <div className="mt-0.5">
                    {order.total} pieces in this order · {order.packed} packed.
                    Hold for the rest.
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-800">
                  Single piece — ready to pack.
                </div>
              )
            ) : null}

            {piece.status !== "packed" ? (
              <Form method="post" className="mt-3">
                <input type="hidden" name="intent" value="pack" />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-teal-600 px-4 py-3 text-sm font-medium text-white hover:bg-teal-700"
                >
                  Mark packed
                </button>
              </Form>
            ) : null}

            <Link
              to={`/pack/${encodeURIComponent(piece.job.orderName)}`}
              className="mt-3 block text-center text-sm text-teal-700 hover:underline"
            >
              Open order {piece.job.orderName}
            </Link>

            {piece.bed ? (
              <Link
                to={`/beds/${piece.bed.id}`}
                className="mt-2 block text-center text-sm text-gray-500 hover:underline"
              >
                Open bed {piece.bed.workOrderNum}
              </Link>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
