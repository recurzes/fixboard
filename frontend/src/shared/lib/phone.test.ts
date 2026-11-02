import { expect, it } from "vitest";
import { formatPhone, formatPhoneInput, isValidPhone } from "./phone";

it.each([
  "5551234567",
  "555-123-4567",
  "+15551234567",
  "1 555 123 4567",
  "(555) 123-4567",
  " 555.123.4567 ",
])("%s displays the same and is valid", (raw) => {
  expect(formatPhone(raw)).toBe("(555) 123-4567");
  expect(isValidPhone(raw)).toBe(true);
});

it.each([
  "",
  "junk",
  "555-1234",
  "55512345678",
  "+445551234567",
  "555123456a",
  "(000) 000-0000",
  "1115551234",
])("%s is rejected and displays unchanged", (raw) => {
  expect(isValidPhone(raw)).toBe(false);
  expect(formatPhone(raw)).toBe(raw);
});

it.each([
  ["", ""],
  ["5", "(5"],
  ["555", "(555"],
  ["5551", "(555) 1"],
  ["555123", "(555) 123"],
  ["5551234", "(555) 123-4"],
  ["5551234567", "(555) 123-4567"],
  ["55512345678", "(555) 123-4567"],
  ["+15551234567", "(555) 123-4567"],
  ["abc", ""],
  // What a backspace leaves behind, which must not get stuck on the punctuation.
  ["(555) ", "(555"],
  ["(555) 123-", "(555) 123"],
])("typing %s shows %s", (typed, shown) => {
  expect(formatPhoneInput(typed)).toBe(shown);
});
