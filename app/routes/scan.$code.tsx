import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import invariant from "tiny-invariant";

import { getPieceByQr } from "~/models/piece.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction = () => [{ title: "Scan — Print Station" }];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireStaff(request);
  invariant(params.code, "code is required");

  const piece = await getPieceByQr(params.code);
  return json({ code: params.code, piece });
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
  const { code, piece } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-full bg-gray-50">
      <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-6 py-4">
        <Link to="/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Scan result</h1>
      </header>

      <main className="mx-auto max-w-md px-6 py-8">
        {!piece ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-center">
            <p className="font-medium text-red-800">No piece found</p>
            <p className="mt-1 text-sm text-red-600">
              Code <span className="font-mono">{code}</span> isn&apos;t in the
              system.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
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

            {piece.bed ? (
              <Link
                to={`/beds/${piece.bed.id}`}
                className="mt-5 block rounded bg-blue-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-blue-700"
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
