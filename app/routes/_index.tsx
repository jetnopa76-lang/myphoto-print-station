import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getStaffId } from "~/session.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const staffId = await getStaffId(request);
  return redirect(staffId ? "/dashboard" : "/login");
};
