import { expect, it } from "vitest";
import { formReducer, initialFormState, LAST_STEP } from "./formState";

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
