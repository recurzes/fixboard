import { expect, it } from "vitest";
import formConfig from "../../../../backend/app/intake/form_config.json";
import { formReducer, initialFormState } from "../../shared/form/formState";
import type {
  FormAction,
  FormFields,
  FormState,
} from "../../shared/form/formState";
import {
  buildSubmission,
  newIdempotencyKey,
  placeFieldErrors,
} from "./submission";
import type { Category } from "../../shared/form/usePublicConfig";
import {
  validateStep1,
  validateStep2,
  validateStep3,
} from "../../shared/form/validation";

// The categories walked below all have options, which is what the server's defaults would add.
const categories = formConfig.categories as unknown as Category[];
const categoryById = (id: string) =>
  categories.find((category) => category.id === id)!;

const filled: FormFields = {
  ...initialFormState.fields,
  property_id: "1",
  unit_id: "11",
  tenant_name: "Sam",
  phone: "(555) 123-4567",
  category: "plumbing",
  description: "Leak",
  entry_permission: "anytime",
  not_an_emergency: true,
};

const sent = (body: FormData) => JSON.parse(body.get("data") as string);

it("sends exactly the fields the backend reads", () => {
  expect(Object.keys(sent(buildSubmission(filled, []))).sort())
    .toMatchInlineSnapshot(`
      [
        "category",
        "description",
        "email",
        "entry_notes",
        "entry_permission",
        "followup_answers",
        "not_an_emergency",
        "phone",
        "self_check_tried",
        "tenant_name",
        "unit_id",
        "website",
      ]
    `);
});

it("sends the unit as a number, blank notes as null, and photos in order", () => {
  const photos = [new File(["a"], "a.jpg"), new File(["b"], "b.jpg")];
  const body = buildSubmission({ ...filled, entry_notes: "  " }, photos);

  expect([...body.keys()]).toEqual(["data", "photos", "photos"]);
  expect(body.getAll("photos").map((photo) => (photo as File).name)).toEqual([
    "a.jpg",
    "b.jpg",
  ]);
  expect(sent(body).unit_id).toBe(11);
  expect(sent(body).entry_notes).toBeNull();
});

it("carries a filled honeypot, and leaves it empty in normal use", () => {
  expect(sent(buildSubmission(filled, [])).website).toBe("");
  expect(
    sent(buildSubmission({ ...filled, website: "spam.example" }, [])).website,
  ).toBe("spam.example");
});

it("makes keys the backend accepts, and never the same one twice", () => {
  const key = newIdempotencyKey();
  expect(key.length).toBeGreaterThanOrEqual(16);
  expect(key.length).toBeLessThanOrEqual(255);
  expect(newIdempotencyKey()).not.toBe(key);
});

it.each([
  ["body", 1, "phone"],
  ["body.unit_id", 1, "unit_id"],
  ["body.tenant_name", 1, "tenant_name"],
  ["body.phone", 1, "phone"],
  ["body.email", 1, "email"],
  ["body.category", 2, "category"],
  ["body.followup_answers", 2, "category"],
  ["body.followup_answers.gas_smell", 2, "gas_smell"],
  ["body.description", 3, "description"],
  ["body.entry_permission", 3, "entry_permission"],
  ["body.entry_notes", 3, "entry_notes"],
  ["body.not_an_emergency", 3, "not_an_emergency"],
  ["body.photos", 3, "photos"],
  ["body.photos.0", 3, "photos"],
])("places the server's %s on step %i, at %s", (field, step, key) => {
  const placed = placeFieldErrors([
    { field, message: "Value error, from the server" },
  ]);
  expect(placed.step).toBe(step);
  expect(Object.keys(placed.errors)).toEqual([key]);
  expect(placed.errors[key]).not.toContain("Value error");
});

it("goes to the earliest step, and lists every refused photo", () => {
  const placed = placeFieldErrors([
    { field: "body.photos.1", message: "" },
    { field: "body.photos.3", message: "" },
    { field: "body.email", message: "" },
  ]);
  expect(placed.step).toBe(1);
  expect(placed.errors.photos).toContain("photo 2");
  expect(placed.errors.photos).toContain("photo 4");
});

it("reports no step for a field it doesn't know", () => {
  expect(placeFieldErrors([{ field: "body.new", message: "" }])).toEqual({
    step: null,
    errors: {},
  });
});

const set = <K extends keyof FormFields>(
  field: K,
  value: FormFields[K],
): FormAction => ({ type: "set", field, value }) as FormAction;

const answer = (category: string, question: string, value: string) =>
  ({
    type: "answer",
    category: categoryById(category),
    question,
    value,
  }) as FormAction;

const walk = (state: FormState, actions: FormAction[]) =>
  actions.reduce(formReducer, state);

function step1() {
  const state = walk(initialFormState, [
    set("property_id", "1"),
    set("unit_id", "11"),
    set("tenant_name", "Sam"),
    set("email", "sam@example.com"),
  ]);
  expect(validateStep1(state.fields)).toEqual({});
  return formReducer(state, { type: "next" });
}

function step3(state: FormState) {
  expect(validateStep2(state.fields, categories)).toEqual({});
  const details = walk(state, [
    { type: "next" },
    set("description", "No cold air"),
    set("entry_permission", "notify_first"),
    set("not_an_emergency", true),
  ]);
  expect(details.step).toBe(3);
  expect(validateStep3(details.fields, true)).toEqual({});
  return details;
}

it("walks from empty to payload on the AC urgent path, sending no urgent flag", () => {
  const issue = walk(step1(), [
    set("category", "ac_heating"),
    answer("ac_heating", "symptom", "warm_air"),
    answer("ac_heating", "filter_changed", "not_sure"),
    answer("ac_heating", "above_90", "yes"),
    answer("ac_heating", "gas_smell", "no"),
  ]);

  const data = sent(buildSubmission(step3(issue).fields, []));

  expect(data).toEqual({
    unit_id: 11,
    tenant_name: "Sam",
    phone: "",
    email: "sam@example.com",
    category: "ac_heating",
    description: "No cold air",
    entry_permission: "notify_first",
    entry_notes: null,
    followup_answers: {
      symptom: "warm_air",
      filter_changed: "not_sure",
      above_90: "yes",
      gas_smell: "no",
    },
    self_check_tried: false,
    not_an_emergency: true,
    website: "",
  });
  expect(JSON.stringify(data)).not.toContain("urgent");
});

it("sends only the last category's answers after a switch, with its self-check tick", () => {
  const issue = walk(step1(), [
    set("category", "ac_heating"),
    answer("ac_heating", "above_90", "yes"),
    set("category", "plumbing"),
    answer("plumbing", "problem", "clogged_drain"),
    answer("plumbing", "location", "kitchen"),
    set("self_check_tried", true),
  ]);

  const data = sent(buildSubmission(step3(issue).fields, []));

  expect(data.category).toBe("plumbing");
  expect(data.followup_answers).toEqual({
    problem: "clogged_drain",
    location: "kitchen",
  });
  expect(data.self_check_tried).toBe(true);
  expect(data).not.toHaveProperty("self_check_shown");
  expect(data).not.toHaveProperty("property_id");
});
