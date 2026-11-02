import { expect, it } from "vitest";
import { formReducer, initialFormState, LAST_STEP } from "./formState";
import type { Category } from "./usePublicConfig";

const option = (value: string, extra = {}) => ({
  value,
  label: value,
  urgent: false,
  self_check: null,
  ...extra,
});
const PLUMBING: Category = {
  id: "plumbing",
  label: "Plumbing",
  questions: [
    {
      id: "problem",
      label: "Problem",
      type: "single_choice",
      required: true,
      options: [
        option("clogged", {
          self_check: {
            id: "drain",
            text: "Try a plunger",
            pending_client_approval: true,
          },
        }),
        option("flood", { urgent: true }),
      ],
    },
    {
      id: "where",
      label: "Where",
      type: "single_choice",
      required: true,
      options: [option("kitchen"), option("bath")],
    },
  ],
};

const answer = (
  state: typeof initialFormState,
  question: string,
  value: string,
) =>
  formReducer(state, { type: "answer", category: PLUMBING, question, value });

const tried = (state: typeof initialFormState) =>
  formReducer(state, { type: "set", field: "self_check_tried", value: true });

it("set changes one field and leaves the rest", () => {
  const state = formReducer(initialFormState, {
    type: "set",
    field: "tenant_name",
    value: "Sam Lee",
  });
  expect(state.fields).toEqual({
    ...initialFormState.fields,
    tenant_name: "Sam Lee",
  });
  expect(initialFormState.fields.tenant_name).toBe("");
});

it("changing the property clears the unit", () => {
  const state = formReducer(
    {
      ...initialFormState,
      fields: { ...initialFormState.fields, property_id: "1", unit_id: "9" },
    },
    { type: "set", field: "property_id", value: "2" },
  );
  expect(state.fields.property_id).toBe("2");
  expect(state.fields.unit_id).toBe("");
});

it("stores answers by question id", () => {
  const state = answer(
    answer(initialFormState, "problem", "flood"),
    "where",
    "bath",
  );
  expect(state.fields.followup_answers).toEqual({
    problem: "flood",
    where: "bath",
  });
});

it("changing the category leaves nothing from the old one", () => {
  const state = formReducer(
    tried(answer(initialFormState, "problem", "clogged")),
    {
      type: "set",
      field: "category",
      value: "electrical",
    },
  );
  expect(state.fields.category).toBe("electrical");
  expect(state.fields.followup_answers).toEqual({});
  expect(state.fields.self_check_shown).toBe("");
  expect(state.fields.self_check_tried).toBe(false);
});

it("records which self-check was shown and whether it was tried", () => {
  const state = tried(answer(initialFormState, "problem", "clogged"));
  expect(state.fields.self_check_shown).toBe("drain");
  expect(state.fields.self_check_tried).toBe(true);
});

it("keeps the tick when another question changes", () => {
  const state = answer(
    tried(answer(initialFormState, "problem", "clogged")),
    "where",
    "bath",
  );
  expect(state.fields.self_check_shown).toBe("drain");
  expect(state.fields.self_check_tried).toBe(true);
});

it("drops the tick for good when the answer changes", () => {
  const changed = answer(
    tried(answer(initialFormState, "problem", "clogged")),
    "problem",
    "flood",
  );
  expect(changed.fields.self_check_shown).toBe("");
  expect(changed.fields.self_check_tried).toBe(false);

  const back = answer(changed, "problem", "clogged");
  expect(back.fields.self_check_shown).toBe("drain");
  expect(back.fields.self_check_tried).toBe(false);
});

it("keeps no urgent flag in the state, so none can be sent", () => {
  const { fields } = answer(initialFormState, "problem", "flood");
  expect(JSON.stringify(fields)).not.toContain("urgent");
});

it("next and back move one step and stop at each end", () => {
  const back = formReducer(initialFormState, { type: "back" });
  expect(back.step).toBe(1);

  const second = formReducer(initialFormState, { type: "next" });
  expect(second.step).toBe(2);
  expect(formReducer(second, { type: "back" }).step).toBe(1);

  const last = { ...initialFormState, step: LAST_STEP };
  expect(formReducer(last, { type: "next" }).step).toBe(LAST_STEP);
});

it("reset returns every field and the step to the start", () => {
  const changed = formReducer(
    formReducer(initialFormState, {
      type: "set",
      field: "email",
      value: "sam@example.com",
    }),
    { type: "next" },
  );
  expect(formReducer(changed, { type: "reset" })).toEqual(initialFormState);
});
