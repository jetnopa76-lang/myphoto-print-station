import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { verifyBedsterWebhook } from "~/lib/bedster.server";
import { markBedImposed } from "~/models/bed.server";

/**
 * Bedster imposition-complete callback. Bedster POSTs here when a bed's
 * print file is ready. Verifies the shared secret, then flips the bed to
 * `imposed` and stores the print-file URL.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const callback = await verifyBedsterWebhook(request);
  if (!callback) {
    return json({ error: "Invalid signature or payload" }, { status: 401 });
  }

  const bed = await markBedImposed(
    callback.workOrderNum,
    callback.printFileUrl,
    callback.status,
  );
  if (!bed) {
    return json({ error: "Unknown work order" }, { status: 404 });
  }

  return json({ ok: true, status: bed.status });
};
