import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import invariant from "tiny-invariant";

import { getBed } from "~/models/bed.server";
import { generatePiecesForBed, piecesForBed } from "~/models/piece.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `${data.bed.workOrderNum} — Print Station` : "Bed" },
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireStaff(request);
  invariant(params.bedId, "bedId is required");

  const bed = await getBed(params.bedId);
  if (!bed) {
    throw new Response("Bed not found", { status: 404 });
  }
  const pieces = await piecesForBed(bed.id);
  return json({ bed, pieces });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await requireStaff(request);
  invariant(params.bedId, "bedId is required");

  const formData = await request.formData();
  if (formData.get("intent") === "prepare") {
    await generatePiecesForBed(params.bedId);
  }
  return json({ ok: true });
};

export default function BedDetail() {
  const { bed, pieces } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const totalPieces = bed.items.reduce((sum, item) => sum + item.quantity, 0);
  const prepared = pieces.length > 0;
  const preparing =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "prepare";

  return (
    <div className="min-h-full bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <Link to="/beds" className="text-sm text-blue-600 hover:underline">
            ← Beds
          </Link>
          <h1 className="text-xl font-bold text-gray-900">
            {bed.workOrderNum}
          </h1>
          <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
            {bed.status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {prepared ? (
            <a
              href={`/beds/${bed.id}/manifest`}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Download manifest (PDF)
            </a>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="prepare" />
              <button
                type="submit"
                disabled={preparing}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                {preparing ? "Preparing…" : "Prepare pieces for print"}
              </button>
            </Form>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-gray-500">Label</dt>
              <dd className="font-medium text-gray-900">{bed.label}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Size</dt>
              <dd className="font-medium text-gray-900">{bed.size}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Material</dt>
              <dd className="font-medium text-gray-900">{bed.material}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Pieces</dt>
              <dd className="font-medium text-gray-900">{totalPieces}</dd>
            </div>
          </dl>
          {bed.createdBy ? (
            <p className="mt-4 text-xs text-gray-400">
              Created by {bed.createdBy.name}
            </p>
          ) : null}
        </div>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Items ({bed.items.length})
          </h2>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {bed.items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <span>
                  <span className="font-medium text-gray-900">
                    {item.job.orderName}
                  </span>
                  <span className="ml-2 text-gray-500">
                    {item.job.productTitle}
                  </span>
                </span>
                <span className="text-sm text-gray-400">×{item.quantity}</span>
              </li>
            ))}
          </ul>
        </section>

        {prepared ? (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              Pieces ({pieces.length})
            </h2>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {pieces.map((piece) => (
                <li
                  key={piece.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span className="font-mono text-gray-700">
                    {piece.qrCode}
                  </span>
                  <span className="text-gray-500">
                    {piece.job.orderName} · piece {piece.pieceIndex} of{" "}
                    {piece.job.quantity}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
