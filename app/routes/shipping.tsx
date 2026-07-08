import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { AppShell } from "~/components/app-shell";
import { listOrdersForShipping } from "~/models/order.server";
import { requireStaff } from "~/session.server";

export const meta: MetaFunction = () => [
  { title: "Shipping — Print Station" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const staff = await requireStaff(request);
  const orders = await listOrdersForShipping();
  return json({ staffName: staff.name, orders });
};

export default function Shipping() {
  const { staffName, orders } = useLoaderData<typeof loader>();

  return (
    <AppShell active="shipping" staffName={staffName}>
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h1 className="mb-4 text-base font-medium text-gray-900">
          Orders to consolidate + ship
        </h1>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500">
                <th className="px-3 py-2.5 font-medium">Order</th>
                <th className="px-3 py-2.5 text-right font-medium">Pieces</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-gray-400">
                    Nothing waiting to ship.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr
                    key={o.orderName}
                    className="border-t border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-3 py-2.5 font-medium text-gray-900">
                      {o.orderName}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">
                      {o.packed}/{o.total} packed
                    </td>
                    <td className="px-3 py-2.5">
                      {o.allPacked ? (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          Ready to ship
                        </span>
                      ) : o.total > 1 ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Consolidating
                        </span>
                      ) : (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          Single piece
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        to={`/pack/${encodeURIComponent(o.orderName)}`}
                        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
