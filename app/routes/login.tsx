import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useSearchParams } from "@remix-run/react";
import { useEffect, useRef } from "react";

import { verifyStaffLogin } from "~/models/staff.server";
import { createStaffSession, getStaffId } from "~/session.server";
import { safeRedirect, validatePin } from "~/utils";

export const meta: MetaFunction = () => [{ title: "Sign in — Print Station" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const staffId = await getStaffId(request);
  if (staffId) return redirect("/beds");
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const name = formData.get("name");
  const pin = formData.get("pin");
  const redirectTo = safeRedirect(formData.get("redirectTo"), "/beds");

  if (typeof name !== "string" || name.length === 0) {
    return json(
      { errors: { name: "Name is required", pin: null } },
      { status: 400 },
    );
  }

  if (!validatePin(pin)) {
    return json(
      { errors: { name: null, pin: "PIN must be at least 4 digits" } },
      { status: 400 },
    );
  }

  const staff = await verifyStaffLogin(name, pin);
  if (!staff) {
    return json(
      { errors: { name: "Invalid name or PIN", pin: null } },
      { status: 400 },
    );
  }

  return createStaffSession({
    request,
    staffId: staff.id,
    redirectTo,
  });
};

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/beds";
  const actionData = useActionData<typeof action>();
  const nameRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (actionData?.errors?.name) {
      nameRef.current?.focus();
    } else if (actionData?.errors?.pin) {
      pinRef.current?.focus();
    }
  }, [actionData]);

  return (
    <div className="flex min-h-full flex-col justify-center bg-gray-50">
      <div className="mx-auto w-full max-w-sm px-8">
        <h1 className="mb-6 text-center text-2xl font-bold text-gray-900">
          Print Station
        </h1>
        <Form method="post" className="space-y-6">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700"
            >
              Name
            </label>
            <div className="mt-1">
              <input
                ref={nameRef}
                id="name"
                name="name"
                type="text"
                autoComplete="username"
                autoFocus
                required
                aria-invalid={actionData?.errors?.name ? true : undefined}
                aria-describedby="name-error"
                className="w-full rounded border border-gray-300 px-2 py-2 text-lg"
              />
              {actionData?.errors?.name ? (
                <div className="pt-1 text-red-700" id="name-error">
                  {actionData.errors.name}
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <label
              htmlFor="pin"
              className="block text-sm font-medium text-gray-700"
            >
              PIN
            </label>
            <div className="mt-1">
              <input
                ref={pinRef}
                id="pin"
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                required
                aria-invalid={actionData?.errors?.pin ? true : undefined}
                aria-describedby="pin-error"
                className="w-full rounded border border-gray-300 px-2 py-2 text-lg tracking-widest"
              />
              {actionData?.errors?.pin ? (
                <div className="pt-1 text-red-700" id="pin-error">
                  {actionData.errors.pin}
                </div>
              ) : null}
            </div>
          </div>

          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button
            type="submit"
            className="w-full rounded bg-blue-600 px-4 py-3 text-lg font-medium text-white hover:bg-blue-700 focus:bg-blue-500"
          >
            Sign in
          </button>
        </Form>
      </div>
    </div>
  );
}
