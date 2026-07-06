import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";

import {
  BedCreationError,
  createBedFromJobs,
  groupPendingJobs,
  listBeds,
} from "~/models/bed.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction = () => [{ title: "Beds — Print Station" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStaff(request);
  const [groups, openBeds] = await Promise.all([
    groupPendingJobs(),
    listBeds("open"),
  ]);
  return json({ groups, openBeds });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const staff = await requireStaff(request);
  const formData = await request.formData();

  const size = String(formData.get("size") ?? "");
  const material = String(formData.get("material") ?? "");
  const jobIds = formData.getAll("jobId").map(String);

  try {
    const bed = await createBedFromJobs({
      size,
      material,
      jobIds,
      staffId: staff.id,
    });
    return redirect(`/beds/${bed.id}`);
  } catch (error) {
    if (error instanceof BedCreationError) {
      return json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
};

export default function BedsIndex() {
  const { groups, openBeds } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="min-h-full bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm text-blue-600 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Beds</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        {actionData?.error ? (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">
            {actionData.error}
          </div>
        ) : null}

        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Pending jobs, grouped
          </h2>
          {groups.length === 0 ? (
            <p className="text-gray-500">No pending jobs.</p>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <div
                  key={`${group.size}|${group.material}`}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-gray-900">
                        {group.label}
                      </span>
                      <span className="ml-2 text-sm text-gray-500">
                        {group.jobs.length} job
                        {group.jobs.length === 1 ? "" : "s"} ·{" "}
                        {group.totalQuantity} piece
                        {group.totalQuantity === 1 ? "" : "s"}
                      </span>
                    </div>
                    {!group.ready ? (
                      <span className="rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800">
                        needs size/material
                      </span>
                    ) : null}
                  </div>

                  <Form method="post">
                    <input type="hidden" name="size" value={group.size} />
                    <input
                      type="hidden"
                      name="material"
                      value={group.material}
                    />
                    <ul className="mb-3 divide-y divide-gray-100 text-sm">
                      {group.jobs.map((job) => (
                        <li
                          key={job.id}
                          className="flex items-center gap-2 py-1.5"
                        >
                          <input
                            type="checkbox"
                            name="jobId"
                            value={job.id}
                            defaultChecked
                            disabled={!group.ready}
                          />
                          <span className="font-medium text-gray-700">
                            {job.orderName}
                          </span>
                          <span className="text-gray-500">
                            {job.productTitle}
                          </span>
                          <span className="ml-auto text-gray-400">
                            ×{job.quantity}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="submit"
                      disabled={!group.ready}
                      className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      Create bed
                    </button>
                  </Form>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Open beds</h2>
          {openBeds.length === 0 ? (
            <p className="text-gray-500">No open beds.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {openBeds.map((bed) => (
                <li key={bed.id}>
                  <Link
                    to={`/beds/${bed.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                  >
                    <span>
                      <span className="font-medium text-gray-900">
                        {bed.workOrderNum}
                      </span>
                      <span className="ml-2 text-gray-500">{bed.label}</span>
                    </span>
                    <span className="text-sm text-gray-400">
                      {bed._count.items} item
                      {bed._count.items === 1 ? "" : "s"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
