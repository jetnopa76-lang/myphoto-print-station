import { useMatches } from "@remix-run/react";
import { useMemo } from "react";

import type { Staff } from "@prisma/client";

const DEFAULT_REDIRECT = "/";

/**
 * This should be used any time the redirect path is user-provided
 * (Like the query string on our login/signup pages). This avoids
 * open-redirect vulnerabilities.
 * @param {string} to The redirect destination
 * @param {string} defaultRedirect The redirect to use if the to is unsafe.
 */
export function safeRedirect(
  to: FormDataEntryValue | string | null | undefined,
  defaultRedirect: string = DEFAULT_REDIRECT,
) {
  if (!to || typeof to !== "string") {
    return defaultRedirect;
  }
  if (!to.startsWith("/") || to.startsWith("//")) {
    return defaultRedirect;
  }
  return to;
}

/**
 * This base hook is used in other hooks to quickly search for specific data
 * across all loader data using useMatches.
 * @param {string} id The route id
 * @returns {JSON|undefined} The router data or undefined if not found
 */
export function useMatchesData(
  id: string,
): Record<string, unknown> | undefined {
  const matchingRoutes = useMatches();
  const route = useMemo(
    () => matchingRoutes.find((route) => route.id === id),
    [matchingRoutes, id],
  );
  return route?.data as Record<string, unknown>;
}

function isStaff(staff: unknown): staff is Staff {
  return (
    staff != null &&
    typeof staff === "object" &&
    "name" in staff &&
    typeof staff.name === "string"
  );
}

export function useOptionalStaff(): Staff | undefined {
  const data = useMatchesData("root");
  if (!data || !isStaff(data.staff)) {
    return undefined;
  }
  return data.staff;
}

export function useStaff(): Staff {
  const maybeStaff = useOptionalStaff();
  if (!maybeStaff) {
    throw new Error(
      "No staff found in root loader, but staff is required by useStaff. If staff is optional, try useOptionalStaff instead.",
    );
  }
  return maybeStaff;
}

export function validatePin(pin: unknown): pin is string {
  return typeof pin === "string" && pin.length >= 4 && /^\d+$/.test(pin);
}