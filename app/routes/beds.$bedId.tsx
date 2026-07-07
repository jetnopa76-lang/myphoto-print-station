import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import invariant from "tiny-invariant";

import { AppShell } from "~/components/app-shell";
import { sendBedToBedster } from "~/lib/bedster.server";
import {
  claimBed,
  getBed,
  markBedImposed,
  markBedSent,
} from "~/models/bed.server";
import { generatePiecesForBed, piecesForBed } from "~/models/piece.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `${data.bed.workOrderNum} — Print Station` : "Bed" },
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const staff = await requireStaff(request);
  invariant(params.bedId, "bedId is required");

  const bed = await getBed(params.bedId);
  if (!bed) {
    throw new Response("Bed not found", { status: 404 });
  }
  const pieces = await piecesForBed(bed.id);
  const canSimulate = process.env.ALLOW_SIMULATE_IMPOSITION === "true";
  return json({ bed, pieces, canSimulate, staffName: staff.name });
};

function callbackUrl(request: Request): string {
  const host =
    request.headers.get("X-Forwarded-Host") ??
    request.headers.get("host") ??
    "localhost:3000";
  const proto =
    request.headers.get("X-Forwarded-Proto") ??
    (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}/webhooks/bedster`;
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const staff = await requireStaff(request);
  invariant(params.bedId, "bedId is required");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "prepare") {
    await generatePiecesForBed(params.bedId);
    return json({ ok: true });
  }

  if (intent === "send") {
    const bed = await getBed(params.bedId);
    if (!bed) throw new Response("Bed not found", { status: 404 });
    try {
      await sendBedToBedster(bed, callbackUrl(request));
      await markBedSent(bed.id);
      return json({ ok: true });
    } catch (error) {
      return json(
        { ok: false, error: error instanceof Error ? error.message : "Send failed" },
        { status: 400 },
      );
    }
  }

  if (intent === "claim") {
    await claimBed(params.bedId, staff.id, staff.name);
    return json({ ok: true });
  }

  if (intent === "simulate") {
    if (process.env.ALLOW_SIMULATE_IMPOSITION !== "true") {
      return json({ ok: false, error: "Simulation is disabled." }, { status: 403 });
    }
    const bed = await getBed(params.bedId);
    if (!bed) throw new Response("Bed not found", { status: 404 });
    // Stand-in "print file": point at this bed's own manifest so the
    // Print file button downloads something during a dev run.
    await markBedImposed(
      bed.workOrderNum,
      `/beds/${bed.id}/manifest`,
      "imposed",
    );
    return json({ ok: true });
  }

  return json({ ok: true });
};

export default function BedDetail() {
  const { bed, pieces, canSimulate, staffName } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const totalPieces = bed.items.reduce((sum, item) => sum + item.quantity, 0);
  const prepared = pieces.length > 0;
  const pendingIntent =
    navigation.state !== "idle"
      ? navigation.formData?.get("intent")
      : undefined;
  const busy = navigation.state !== "idle";
  const busyPrepare = pendingIntent === "prepare";
  const busySend = pendingIntent === "send";
  const busyClaim = pendingIntent === "claim";
  const sendError = (actionData as { error?: string } | undefined)?.error;

  return (
    <AppShell active="viewer" staffName={staffName}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/beds/viewer"
            className="text-sm text-teal-700 hover:underline"
          >
            ← Queue
          </Link>
          <h1 className="text-xl font-semibold text-gray-900">
            {bed.workOrderNum}
          </h1>
          <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
            {bed.status}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {bed.status === "open" ? (
            <Form method="post">
              <input type="hidden" name="intent" value="send" />
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                {busySend ? "Sending…" : "Send to Bedster"}
              </button>
            </Form>
          ) : null}

          {bed.status === "sent_to_bedster" ? (
            <span className="rounded bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800">
              Awaiting imposition…
            </span>
          ) : null}

          {canSimulate &&
          (bed.status === "open" || bed.status === "sent_to_bedster") ? (
            <Form method="post">
              <input type="hidden" name="intent" value="simulate" />
              <button
                type="submit"
                disabled={busy}
                className="rounded border border-dashed border-purple-400 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50"
                title="Dev only: mark this bed imposed without calling Bedster"
              >
                {pendingIntent === "simulate"
                  ? "Simulating…"
                  : "Simulate imposition (dev)"}
              </button>
            </Form>
          ) : null}

          {bed.status === "imposed" ? (
            <Form method="post">
              <input type="hidden" name="intent" value="claim" />
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:bg-gray-300"
              >
                {busyClaim ? "Claiming…" : "Claim to print"}
              </button>
            </Form>
          ) : null}

          {bed.bedsterUrl && (bed.status === "imposed" || bed.status === "printing") ? (
            <a
              href={bed.bedsterUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Print file
            </a>
          ) : null}

          {prepared ? (
            <a
              href={`/beds/${bed.id}/manifest`}
              className="rounded bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              Download ticket (PDF)
            </a>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="prepare" />
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                {busyPrepare ? "Preparing…" : "Prepare pieces"}
              </button>
            </Form>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {sendError ? (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {sendError}
          </div>
        ) : null}

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
      </div>
    </AppShell>
  );
}
