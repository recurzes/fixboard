import type { Category } from "./usePublicConfig";

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
  // Only for display. The submit body leaves it out, because the server works it out from the answers.
  self_check_shown: string;
  self_check_tried: boolean;
  not_an_emergency: boolean;
  // The honeypot: hidden in the form, so only bots fill it.
  website: string;
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
  | { type: "answer"; category: Category; question: string; value: string }
  | { type: "goto"; step: number }
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
    self_check_shown: "",
    self_check_tried: false,
    not_an_emergency: false,
    website: "",
  },
};

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "set": {
      const fields = { ...state.fields, [action.field]: action.value };
      // A unit belongs to one property, so it can't outlive a change of property.
      if (action.field === "property_id") fields.unit_id = "";
      // The server refuses answers to another category's questions.
      if (action.field === "category") {
        fields.followup_answers = {};
        fields.self_check_shown = "";
        fields.self_check_tried = false;
      }
      return { ...state, fields };
    }
    case "answer": {
      const answers = {
        ...state.fields.followup_answers,
        [action.question]: action.value,
      };
      // First in question order, the same one the server records.
      const shown =
        action.category.questions
          .flatMap((question) =>
            question.options.filter(
              (option) => option.value === answers[question.id],
            ),
          )
          .find((option) => option.self_check)?.self_check?.id ?? "";
      return {
        ...state,
        fields: {
          ...state.fields,
          followup_answers: answers,
          self_check_shown: shown,
          self_check_tried:
            state.fields.self_check_tried &&
            shown === state.fields.self_check_shown,
        },
      };
    }
    case "next":
      return { ...state, step: Math.min(state.step + 1, LAST_STEP) };
    case "back":
      return { ...state, step: Math.max(state.step - 1, 1) };
    case "goto":
      return { ...state, step: action.step };
    case "reset":
      return initialFormState;
  }
}
