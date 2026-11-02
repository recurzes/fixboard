import type { ActionDispatch } from "react";
import { siteConfig } from "../lib/siteConfig";
import { RadioGroup } from "../ui/Choice";
import { Textarea } from "../ui/Field";
import type { FormAction, FormFields } from "./formState";
import type { Step3Errors } from "./validation";

// Same as RequestCreate in backend/app/requests/schemas.py.
const DESCRIPTION_LIMIT = 5000;
const ENTRY_NOTES_LIMIT = 1000;
const WARN_WITHIN = 500;

// Values are the backend's EntryPermission enum. Staff see these same words on the request.
export const ENTRY_OPTIONS = [
  { value: "anytime", label: "Anytime" },
  { value: "notify_first", label: "Tell me first" },
  { value: "only_when_home", label: "Only if I'm home" },
];

type Props = {
  fields: FormFields;
  errors: Step3Errors;
  dispatch: ActionDispatch<[FormAction]>;
};

export function DescriptionField({ fields, errors, dispatch }: Props) {
  const left = DESCRIPTION_LIMIT - fields.description.length;
  const nearLimit = left <= WARN_WITHIN;

  return (
    <div>
      <Textarea
        label="Describe the problem (required)"
        hint="What is happening? When did it start?"
        name="description"
        maxLength={DESCRIPTION_LIMIT}
        value={fields.description}
        error={errors.description}
        onChange={(event) =>
          dispatch({
            type: "set",
            field: "description",
            value: event.target.value,
          })
        }
      />
      {/* Announced only near the limit, or a screen reader would read every keystroke. */}
      <p
        aria-live={nearLimit ? "polite" : "off"}
        className={`mt-1 text-sm ${nearLimit ? "font-medium text-red-700" : "text-gray-700"}`}
      >
        {nearLimit
          ? `${left} characters left`
          : `${fields.description.length} of ${DESCRIPTION_LIMIT} characters`}
      </p>
    </div>
  );
}

/** Entry permission and its notes. */
export function EntryFields({ fields, errors, dispatch }: Props) {
  return (
    <>
      <RadioGroup
        label="Can we enter your home? (required)"
        hint={siteConfig.entryNotice}
        options={ENTRY_OPTIONS}
        value={fields.entry_permission}
        error={errors.entry_permission}
        onChange={(value) =>
          dispatch({ type: "set", field: "entry_permission", value })
        }
      />
      <Textarea
        label="Notes about entering (optional)"
        hint={
          fields.entry_permission === "only_when_home"
            ? "Tell us the days and times you're home, and about any pets."
            : "For example, pets or times that suit you."
        }
        name="entry_notes"
        maxLength={ENTRY_NOTES_LIMIT}
        value={fields.entry_notes}
        error={errors.entry_notes}
        onChange={(event) =>
          dispatch({
            type: "set",
            field: "entry_notes",
            value: event.target.value,
          })
        }
      />
    </>
  );
}
