import { expect, it } from "vitest";
import { initialFormState } from "./formState";
import type { Category } from "./usePublicConfig";
import { validateStep1, validateStep2 } from "./validation";

const valid = {
  ...initialFormState.fields,
  property_id: "1",
  unit_id: "9",
  tenant_name: "Sam Lee",
  phone: "(555) 123-4567",
  email: "sam@example.com",
};

it("passes a complete step", () => {
  expect(validateStep1(valid)).toEqual({});
});

it.each([
  ["missing property", { property_id: "", unit_id: "" }, "property_id"],
  ["missing unit", { unit_id: "" }, "unit_id"],
  ["missing name", { tenant_name: "" }, "tenant_name"],
  ["a name of only spaces", { tenant_name: "   " }, "tenant_name"],
  ["both contacts empty", { phone: "", email: "" }, "phone"],
  ["bad phone", { phone: "(555) 123" }, "phone"],
  ["bad phone beside a good email", { phone: "123" }, "phone"],
  ["bad email", { email: "sam@example" }, "email"],
  ["an email with a space", { email: "sam lee@example.com" }, "email"],
  ["bad email with no phone", { phone: "", email: "sam" }, "email"],
])("refuses %s", (_name, change, field) => {
  expect(Object.keys(validateStep1({ ...valid, ...change }))).toEqual([field]);
});

it.each([
  ["phone only", { email: "" }],
  ["email only", { phone: "" }],
  ["an unusual email the server accepts", { email: "a+b@c.co.uk" }],
  [
    "an email with outer spaces, which the server strips",
    { email: " a@b.co " },
  ],
])("accepts %s", (_name, change) => {
  expect(validateStep1({ ...valid, ...change })).toEqual({});
});

it("names the missing contact in the words the spec asks for", () => {
  expect(validateStep1({ ...valid, phone: "", email: "" }).phone).toBe(
    "Phone or email is required",
  );
});

const question = (id: string, required: boolean) => ({
  id,
  label: id,
  type: "text" as const,
  required,
  options: [],
});
const CATEGORIES: Category[] = [
  {
    id: "other",
    label: "Other",
    questions: [question("needed", true), question("extra", false)],
  },
];
const step2 = (followup_answers: Record<string, string>, category = "other") =>
  validateStep2(
    { ...initialFormState.fields, category, followup_answers },
    CATEGORIES,
  );

it("refuses a step with no category", () => {
  expect(Object.keys(step2({}, ""))).toEqual(["category"]);
});

it.each([
  ["missing", {}],
  ["blank", { needed: "   " }],
])("a %s required answer blocks", (_name, answers) => {
  expect(Object.keys(step2(answers))).toEqual(["needed"]);
});

it("a missing optional answer does not block", () => {
  expect(step2({ needed: "yes" })).toEqual({});
});
