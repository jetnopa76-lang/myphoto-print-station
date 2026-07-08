import { Form, Link, NavLink } from "@remix-run/react";
import type { ReactNode } from "react";

type Tab = "maker" | "viewer" | "lookup" | "reprint" | "shipping";

const TABS: { id: Tab; label: string; to: string }[] = [
  { id: "maker", label: "Bed Maker", to: "/beds" },
  { id: "viewer", label: "Bed Viewer", to: "/beds/viewer" },
  { id: "lookup", label: "WO Lookup", to: "/lookup" },
  { id: "reprint", label: "Reprint", to: "/reprint" },
  { id: "shipping", label: "Shipping", to: "/shipping" },
];

export function AppShell({
  active,
  staffName,
  children,
}: {
  active: Tab;
  staffName?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/beds" className="text-lg font-semibold text-gray-900">
            MyPhoto Print Station
          </Link>
          {staffName ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{staffName}</span>
              <Form method="post" action="/logout">
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Sign out
                </button>
              </Form>
            </div>
          ) : null}
        </div>

        <div className="mx-auto max-w-6xl px-6">
          <nav className="flex gap-1 pb-px">
            {TABS.map((tab) => (
              <NavLink
                key={tab.id}
                to={tab.to}
                end
                className={() =>
                  `border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    tab.id === active
                      ? "border-teal-600 text-teal-700"
                      : "border-transparent text-gray-500 hover:text-gray-800"
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}
