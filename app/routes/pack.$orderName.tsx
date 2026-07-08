import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import invariant from "tiny-invariant";

import { AppShell } from "~/components/app-shell";
import {
  getOrderConsolidation,
  markOrderShipped,
  markPiecePacked,
} from "~/models/order.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? `${data.orderName} — Packing` : "Packing" },
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const staff = await requireStaff(request);
  invariant(params.orderName, "orderName is required");
  const consolidation = await getOrderConsolidation(params.orderName);
  return json({ staffName: staff.name, orderName: params.orderName, consolidation });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const staff = await requireStaff(request);
  invariant(params.orderName, "orderName is required");
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "pack") {
    const qrCode = String(formData.get("qrCode") ?? "").trim();
    if (!qrCode) return json({ error: "Scan or enter a code." });
    try {
      await markPiecePacked(qrCode, staff.id);
      return json({ ok: true, message: `Packed ${qrCode}.` });
    } catch {
      return json({ error: `No piece found for ${qrCode}.` });
    }
  }
  if (intent === "ship") {
    const n = await markOrderShipped(params.orderName, staff.id);
    return json({ ok: true, message: `Shipped ${n} piece${n === 1 ? "" : "s"}.` });
  }
  return json({ ok: true });
};

export default function Pack() {
  const { staffName, orderName, consolidation } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const message = (actionData as { message?: string } | undefined)?.message;
  const error = (actionData as { error?: string } | undefined)?.error;

  return (
    <AppShell active="shipping" staffName={staffName}>
      <div className="mb-4">
        <Link to="/shipping" className="text-sm text-teal-700 hover:underline">
          ← Shipping
        </Link>
      </div>

      {message ? (
        <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {!consolidation ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-500">
          No outstanding pieces for {orderName}.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-gray-900">{orderName}</h1>
            <span
              className={`rounded px-2 py-1 text-xs font-medium ${
                consolidation.allPacked
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {consolidation.packed}/{consolidation.total} packed
            </span>
          </div>

          <Form method="post" className="mb-4 flex gap-2">
            <input type="hidden" name="intent" value="pack" />
            <input
              name="qrCode"
              autoFocus
              placeholder="Scan a piece to pack it (PS-…)"
              className="h-10 flex-1 rounded-md border border-gray-300 px-3 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
            >
              Pack
            </button>
          </Form>

          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {consolidation.pieces.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span>
                  <span className="font-mono text-gray-700">{p.qrCode}</span>
                  <span className="ml-2 text-gray-500">
                    {p.size} · {p.material}
                    {p.bedWorkOrder ? ` · ${p.bedWorkOrder}` : ""}
                  </span>
                </span>
                {p.status === "packed" ? (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    packed
                  </span>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="pack" />
                    <input type="hidden" name="qrCode" value={p.qrCode} />
                    <button
                      type="submit"
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Pack
                    </button>
                  </Form>
                )}
              </li>
            ))}
          </ul>

          {consolidation.allPacked ? (
            <Form method="post" className="mt-4">
              <input type="hidden" name="intent" value="ship" />
              <button
                type="submit"
                className="w-full rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700"
              >
                Mark order shipped
              </button>
            </Form>
          ) : (
            <p className="mt-4 text-center text-sm text-gray-400">
              Pack all {consolidation.total} pieces to enable shipping.
            </p>
          )}
        </div>
      )}
    </AppShell>
  );
}
