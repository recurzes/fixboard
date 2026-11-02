export const LAST_STEP = 3;

// Named after the backend's RequestCreate. In memory only: no form value may reach browser storage.
export type FormFields = {
  // Only picks which units to list. The submit body leaves it out, because a unit implies its property.
  property_id: string;
  unit_id: string;
  tenant_name: string;
  phone: string;
  email: string;
  category: string;
  description: string;
  entry_permission: string;
  entry_notes: string;
  followup_answers: Record<string, string>;
  self_check_tried: boolean;
  not_an_emergency: boolean;
};

export type FormState = { step: number; fields: FormFields };

export type FormAction =
  | {
      [K in keyof FormFields]: {
        type: "set";
        field: K;
        value: FormFields[K];
      };
    }[keyof FormFields]
  | { type: "next" | "back" | "reset" };

export const initialFormState: FormState = {
  step: 1,
  fields: {
    property_id: "",
    unit_id: "",
    tenant_name: "",
    phone: "",
    email: "",
    category: "",
    description: "",
    entry_permission: "",
    entry_notes: "",
    followup_answers: {},
    self_check_tried: false,
    not_an_emergency: false,
  },
};

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "set": {
      const fields = { ...state.fields, [action.field]: action.value };
      // A unit belongs to one property, so it can't outlive a change of property.
      if (action.field === "property_id") fields.unit_id = "";
      return { ...state, fields };
    }
    case "next":
      return { ...state, step: Math.min(state.step + 1, LAST_STEP) };
    case "back":
      return { ...state, step: Math.max(state.step - 1, 1) };
    case "reset":
      return initialFormState;
  }
}
