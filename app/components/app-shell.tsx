import { Form, Link, NavLink, useNavigate } from "@remix-run/react";
import { useEffect, useState, type ReactNode } from "react";

import { scanPath } from "~/lib/scan";

type Tab = "maker" | "viewer" | "lookup" | "reprint" | "shipping";

/**
 * Route on QR/barcode scans from a USB (keyboard-wedge) scanner. Scanners
 * "type" the code fast and end with Enter. When the scan matches one of our
 * codes and no input is focused, we navigate to it. If a field is focused
 * (e.g. a pack/QC box), we leave the scan to that field.
 */
function useScanNavigation() {
  const navigate = useNavigate();
  const [debug, setDebug] = useState<string | null>(null);
  useEffect(() => {
    let buffer = "";
    let last = 0;
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      const now = Date.now();
      if (now - last > 300) buffer = ""; // slow keystrokes = a human typing
      last = now;

      if (e.key === "Enter") {
        const scanned = buffer;
        buffer = "";
        const path = scanPath(scanned);
        setDebug(
          `captured "${scanned.slice(0, 60)}" → ${path ?? "no match"}${
            typing ? " (field focused)" : ""
          }`,
        );
        if (typing) return; // focused field handles the scan
        if (path) {
          e.preventDefault();
          navigate(path);
        }
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);
  return debug;
}

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
  const scanDebug = useScanNavigation();
  return (
    <div className="min-h-full bg-gray-50">
      {scanDebug ? (
        <div className="fixed bottom-3 left-3 z-50 max-w-md rounded-md bg-gray-900/90 px-3 py-2 font-mono text-xs text-white">
          scan: {scanDebug}
        </div>
      ) : null}
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
