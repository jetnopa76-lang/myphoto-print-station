import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { useMemo, useState } from "react";

import { AppShell } from "~/components/app-shell";
import { capacityKey, fillPercent } from "~/lib/bed-capacity";
import { getCapacityMap } from "~/lib/bedster.server";
import { isReprintJob } from "~/lib/reprint";
import {
  BedCreationError,
  createBedFromSelection,
  groupPendingJobs,
} from "~/models/bed.server";
import { generatePiecesForBed } from "~/models/piece.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction = () => [
  { title: "Bed Maker — Print Station" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const staff = await requireStaff(request);
  const [groups, capacities] = await Promise.all([
    groupPendingJobs(),
    getCapacityMap(),
  ]);
  const jobs = groups.flatMap((g) => g.jobs);
  return json({ staffName: staff.name, jobs, capacities });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const staff = await requireStaff(request);
  const formData = await request.formData();
  const jobIds = formData.getAll("jobId").map(String);

  try {
    const bed = await createBedFromSelection(jobIds, staff.id);
    // Generate QR pieces right away so the ticket is ready to download.
    await generatePiecesForBed(bed.id);
    return redirect(`/beds/${bed.id}`);
  } catch (error) {
    if (error instanceof BedCreationError) {
      return json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};

const PER_PAGE = 10;

type AggRow = {
  key: string;
  size: string;
  material: string;
  productTitle: string;
  sku: string;
  orders: string[];
  jobIds: string[];
  qty: number;
  reprint: boolean;
};

export default function BedMaker() {
  const { staffName, jobs, capacities } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const [search, setSearch] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sizes = useMemo(
    () => [...new Set(jobs.map((j) => j.size))].sort(),
    [jobs],
  );
  const materials = useMemo(
    () => [...new Set(jobs.map((j) => j.material))].sort(),
    [jobs],
  );

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (sizeFilter && j.size !== sizeFilter) return false;
      if (materialFilter && j.material !== materialFilter) return false;
      if (!q) return true;
      return (
        j.orderName.toLowerCase().includes(q) ||
        j.sku.toLowerCase().includes(q) ||
        j.productTitle.toLowerCase().includes(q)
      );
    });
  }, [jobs, search, sizeFilter, materialFilter]);

  // Aggregate same-kind jobs (same product + size + material) into one row,
  // summing quantity so identical items fill one bed together.
  const rows = useMemo(() => {
    const map = new Map<string, AggRow>();
    for (const j of filteredJobs) {
      const key = `${j.size}|${j.material}|${j.sku || j.productTitle}`;
      let r = map.get(key);
      if (!r) {
        r = {
          key,
          size: j.size,
          material: j.material,
          productTitle: j.productTitle,
          sku: j.sku,
          orders: [],
          jobIds: [],
          qty: 0,
          reprint: false,
        };
        map.set(key, r);
      }
      r.jobIds.push(j.id);
      r.orders.push(j.orderName);
      r.qty += j.quantity;
      if (isReprintJob(j.lineItemKey)) r.reprint = true;
    }
    return [...map.values()];
  }, [filteredJobs]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  const selectedRows = rows.filter((r) => selected.has(r.key));
  const first = selectedRows[0];
  const uniform =
    selectedRows.length === 0 ||
    selectedRows.every(
      (r) => r.size === first.size && r.material === first.material,
    );
  const selectedJobIds = selectedRows.flatMap((r) => r.jobIds);
  const canCreate = selectedRows.length > 0 && uniform;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of pageRows) {
        if (checked) next.add(r.key);
        else next.delete(r.key);
      }
      return next;
    });
  }

  const allPageSelected =
    pageRows.length > 0 && pageRows.every((r) => selected.has(r.key));

  function resetFilters() {
    setSearch("");
    setSizeFilter("");
    setMaterialFilter("");
    setPage(0);
  }

  return (
    <AppShell active="maker" staffName={staffName}>
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h1 className="mb-4 text-base font-medium text-gray-900">
          Create print bed
        </h1>

        {actionData?.error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {actionData.error}
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search order, SKU, or description…"
            className="h-9 flex-1 rounded-md border border-gray-300 px-3 text-sm"
          />
          <select
            value={sizeFilter}
            onChange={(e) => {
              setSizeFilter(e.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border border-gray-300 px-2 text-sm"
          >
            <option value="">All sizes</option>
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={materialFilter}
            onChange={(e) => {
              setMaterialFilter(e.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border border-gray-300 px-2 text-sm"
          >
            <option value="">All materials</option>
            {materials.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            onClick={resetFilters}
            className="h-9 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Reset
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500">
                <th className="w-9 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={(e) => togglePage(e.target.checked)}
                  />
                </th>
                <th className="px-3 py-2.5 font-medium">Description</th>
                <th className="px-3 py-2.5 font-medium">SKU</th>
                <th className="px-3 py-2.5 font-medium">Material</th>
                <th className="px-3 py-2.5 font-medium">Size</th>
                <th className="px-3 py-2.5 text-right font-medium">Orders</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="w-36 px-3 py-2.5 font-medium">Filled</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-8 text-center text-gray-400"
                  >
                    No pending work orders.
                  </td>
                </tr>
              ) : (
                pageRows.map((r) => {
                  const cap =
                    capacities[capacityKey(r.size, r.material)] ?? null;
                  const pct = fillPercent(r.qty, cap);
                  return (
                    <tr
                      key={r.key}
                      className="border-t border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(r.key)}
                          onChange={() => toggle(r.key)}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-gray-900">
                        <span className="font-medium">{r.productTitle}</span>
                        {r.reprint ? (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                            reprint
                          </span>
                        ) : null}
                        <div className="text-xs text-gray-400">
                          {r.orders.join(", ")}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-gray-500">
                        {r.sku || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">
                        {r.material}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{r.size}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">
                        {r.orders.length}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-900">
                        {r.qty}
                      </td>
                      <td className="px-3 py-2.5">
                        {cap === null ? (
                          <span
                            className="text-xs text-gray-400"
                            title="No Bedster template for this size/material yet"
                          >
                            —
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-teal-100">
                              <div
                                className="h-full rounded-full bg-teal-600"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="whitespace-nowrap text-xs text-gray-400">
                              {r.qty}/{cap}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-gray-400">
            {selectedRows.length} of {rows.length} selected ·{" "}
            {selectedJobIds.length} piece
            {selectedJobIds.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPage(Math.max(0, current - 1))}
              disabled={current === 0}
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-gray-500">
              Page {current + 1} of {pageCount}
            </span>
            <button
              onClick={() => setPage(Math.min(pageCount - 1, current + 1))}
              disabled={current >= pageCount - 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          {!uniform ? (
            <span className="text-sm text-amber-700">
              Select one size + material to make a bed.
            </span>
          ) : null}
          <Form method="post">
            {selectedJobIds.map((id) => (
              <input key={id} type="hidden" name="jobId" value={id} />
            ))}
            <button
              type="submit"
              disabled={!canCreate}
              className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Create bed ({selectedJobIds.length})
            </button>
          </Form>
        </div>
      </div>
    </AppShell>
  );
}
