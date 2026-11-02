import type { ActionDispatch } from "react";
import { siteConfig } from "../../shared/lib/siteConfig";
import { Checkbox, RadioGroup } from "../../shared/ui/Choice";
import { EmergencyLink } from "../../shared/ui/ErrorScreen";
import { Textarea } from "../../shared/ui/Field";
import type { FormAction, FormFields } from "./formState";
import { PhotoPicker } from "./PhotoPicker";
import type { usePhotos } from "./photos";
import type { Step3Errors } from "./validation";

// Same as RequestCreate in backend/app/requests/schemas.py.
const DESCRIPTION_LIMIT = 5000;
const ENTRY_NOTES_LIMIT = 1000;
const WARN_WITHIN = 500;

// Values are the backend's EntryPermission enum.
const ENTRY_OPTIONS = [
  { value: "anytime", label: "Anytime" },
  { value: "notify_first", label: "Tell me first" },
  { value: "only_when_home", label: "Only if I'm home" },
];

export function DetailsStep({
  fields,
  errors,
  requireEmergencyAck,
  photos,
  dispatch,
}: {
  fields: FormFields;
  errors: Step3Errors;
  requireEmergencyAck: boolean;
  photos: ReturnType<typeof usePhotos>;
  dispatch: ActionDispatch<[FormAction]>;
}) {
  const left = DESCRIPTION_LIMIT - fields.description.length;
  const nearLimit = left <= WARN_WITHIN;

  return (
    <div className="space-y-4">
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

      <PhotoPicker photos={photos} />

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
        onChange={(event) =>
          dispatch({
            type: "set",
            field: "entry_notes",
            value: event.target.value,
          })
        }
      />

      {requireEmergencyAck && (
        <div>
          <p>
            If anyone is in danger, or there is gas, fire, or flooding, call{" "}
            <EmergencyLink />.
          </p>
          <Checkbox
            label="This is not an emergency"
            name="not_an_emergency"
            checked={fields.not_an_emergency}
            error={errors.not_an_emergency}
            onChange={(event) =>
              dispatch({
                type: "set",
                field: "not_an_emergency",
                value: event.target.checked,
              })
            }
          />
        </div>
      )}
    </div>
  );
}
