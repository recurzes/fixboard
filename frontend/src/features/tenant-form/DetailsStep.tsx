import type { ActionDispatch } from "react";
import { DescriptionField, EntryFields } from "../../shared/form/DetailsFields";
import type { FormAction, FormFields } from "../../shared/form/formState";
import type { Step3Errors } from "../../shared/form/validation";
import { Checkbox } from "../../shared/ui/Choice";
import { EmergencyLink } from "../../shared/ui/ErrorScreen";
import { Alert } from "../../shared/ui/Feedback";
import { PhotoPicker } from "./PhotoPicker";
import type { usePhotos } from "./photos";

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
  return (
    <div className="space-y-4">
      <DescriptionField fields={fields} errors={errors} dispatch={dispatch} />

      <PhotoPicker photos={photos} />
      {errors.photos && <Alert variant="error">{errors.photos}</Alert>}

      <EntryFields fields={fields} errors={errors} dispatch={dispatch} />

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
