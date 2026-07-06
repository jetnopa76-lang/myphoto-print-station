import { validatePin } from "./utils";

test("validatePin returns false for non-PINs", () => {
  expect(validatePin(undefined)).toBe(false);
  expect(validatePin(null)).toBe(false);
  expect(validatePin("")).toBe(false);
  expect(validatePin("abc")).toBe(false);
  expect(validatePin("123")).toBe(false); // too short
  expect(validatePin("12a4")).toBe(false); // non-digit
});

test("validatePin returns true for valid PINs", () => {
  expect(validatePin("1234")).toBe(true);
  expect(validatePin("123456")).toBe(true);
});
