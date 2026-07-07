import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

import { AppShell } from "~/components/app-shell";
import { REPRINT_REASONS } from "~/lib/reprint";
import { getPieceByQr } from "~/models/piece.server";
import { requestReprint } from "~/models/qc.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction = () => [
  { title: "Reprint — Print Station" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const staff = await requireStaff(request);
  const code = new URL(request.url).searchParams.get("code")?.trim();

  if (!code) {
    return json({ staffName: staff.name, lookup: null });
  }

  const piece = await getPieceByQr(code.toUpperCase());
  return json({
    staffName: staff.name,
    lookup: {
      code: code.toUpperCase(),
      piece: piece
        ? {
            qrCode: piece.qrCode,
            order: piece.job.orderName,
            product: piece.job.productTitle,
            size: piece.job.size,
            material: piece.job.material,
            pieceIndex: piece.pieceIndex,
            quantity: piece.job.quantity,
            status: piece.status,
          }
        : null,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const staff = await requireStaff(request);
  const payload = String((await request.formData()).get("payload") ?? "[]");

  let items: { qrCode: string; reason: string }[] = [];
  try {
    items = JSON.parse(payload);
  } catch {
    return json({ submitted: 0, failed: 0, error: "Bad payload" }, { status: 400 });
  }

  let submitted = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await requestReprint(item.qrCode, staff.id, item.reason);
      submitted += 1;
    } catch {
      failed += 1;
    }
  }
  return json({ submitted, failed });
};

type ScannedItem = {
  qrCode: string;
  order: string;
  product: string;
  size: string;
  reason: string;
};

export default function Reprint() {
  const { staffName } = useLoaderData<typeof loader>();
  const lookup = useFetcher<typeof loader>();
  const submit = useFetcher<typeof action>();

  const [items, setItems] = useState<ScannedItem[]>([]);
  const [applyReason, setApplyReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const processed = useRef<string | null>(null);

  // When a scan lookup resolves, add it (or show an error).
  useEffect(() => {
    if (lookup.state !== "idle" || !lookup.data?.lookup) return;
    const { code, piece } = lookup.data.lookup;
    if (processed.current === code) return;
    processed.current = code;

    if (!piece) {
      setError(`No piece found for “${code}”.`);
      return;
    }
    setItems((prev) => {
      if (prev.some((i) => i.qrCode === piece.qrCode)) {
        setError(`${piece.qrCode} is already in the list.`);
        return prev;
      }
      setError(null);
      return [
        ...prev,
        {
          qrCode: piece.qrCode,
          order: piece.order,
          product: piece.product,
          size: piece.size,
          reason: "",
        },
      ];
    });
  }, [lookup.state, lookup.data]);

  // After a successful submit, clear the list.
  useEffect(() => {
    if (submit.state === "idle" && submit.data?.submitted !== undefined) {
      if (submit.data.submitted > 0) {
        setDone(
          `Queued ${submit.data.submitted} reprint${
            submit.data.submitted === 1 ? "" : "s"
          }.` + (submit.data.failed ? ` ${submit.data.failed} failed.` : ""),
        );
        setItems([]);
        setApplyReason("");
      }
    }
  }, [submit.state, submit.data]);

  function scan(e: React.FormEvent) {
    e.preventDefault();
    const value = inputRef.current?.value.trim();
    if (!value) return;
    processed.current = null;
    setDone(null);
    lookup.load(`/reprint?code=${encodeURIComponent(value)}`);
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.focus();
  }

  function setReason(qrCode: string, reason: string) {
    setItems((prev) =>
      prev.map((i) => (i.qrCode === qrCode ? { ...i, reason } : i)),
    );
  }

  function applyToAll() {
    if (!applyReason) return;
    setItems((prev) => prev.map((i) => ({ ...i, reason: applyReason })));
  }

  function remove(qrCode: string) {
    setItems((prev) => prev.filter((i) => i.qrCode !== qrCode));
  }

  const allHaveReason = items.length > 0 && items.every((i) => i.reason);

  function submitAll() {
    if (!allHaveReason) return;
    submit.submit(
      { payload: JSON.stringify(items) },
      { method: "post", action: "/reprint" },
    );
  }

  return (
    <AppShell active="reprint" staffName={staffName}>
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">
          Scan items for reprint
        </h1>
        <p className="text-sm text-gray-500">
          Scan each item, choose a reason, then submit to the reprint queue.
        </p>
      </div>

      {done ? (
        <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
          {done}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Scan serial number
            </label>
            <lookup.Form onSubmit={scan} className="flex gap-2">
              <input
                ref={inputRef}
                name="code"
                autoFocus
                placeholder="Scan or type a QR code (PS-…)"
                className="h-10 flex-1 rounded-md border border-gray-300 px-3 text-sm"
              />
              <button
                type="submit"
                className="rounded-md bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
              >
                Scan
              </button>
            </lookup.Form>
            {error ? (
              <p className="mt-2 text-sm text-red-600">{error}</p>
            ) : null}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 text-sm font-medium text-gray-700">
              Apply reason to all items
            </div>
            <div className="flex gap-2">
              <select
                value={applyReason}
                onChange={(e) => setApplyReason(e.target.value)}
                className="h-10 flex-1 rounded-md border border-gray-300 px-2 text-sm"
              >
                <option value="">Select a reason…</option>
                {REPRINT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                onClick={applyToAll}
                disabled={!applyReason || items.length === 0}
                className="rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Apply to all
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setItems([])}
                disabled={items.length === 0}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Clear all
              </button>
              <button
                onClick={submitAll}
                disabled={!allHaveReason || submit.state !== "idle"}
                className="flex-1 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {items.length === 0
                  ? "No items to submit"
                  : `Submit ${items.length} to reprint queue`}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          {items.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center text-center">
              <p className="font-medium text-gray-500">No items scanned yet</p>
              <p className="text-sm text-gray-400">
                Scan a serial number to begin
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.qrCode}
                  className="rounded-lg border border-gray-200 p-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-gray-900">
                        {item.order} — {item.product}
                      </div>
                      <div className="font-mono text-xs text-gray-500">
                        {item.qrCode} · {item.size}
                      </div>
                    </div>
                    <button
                      onClick={() => remove(item.qrCode)}
                      className="text-gray-400 hover:text-red-600"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </div>
                  <select
                    value={item.reason}
                    onChange={(e) => setReason(item.qrCode, e.target.value)}
                    className={`mt-2 h-9 w-full rounded-md border px-2 text-sm ${
                      item.reason ? "border-gray-300" : "border-amber-300"
                    }`}
                  >
                    <option value="">Select a reason…</option>
                    {REPRINT_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
