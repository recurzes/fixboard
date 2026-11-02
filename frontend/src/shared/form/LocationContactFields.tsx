import { useQuery } from "@tanstack/react-query";
import type { ActionDispatch } from "react";
import { apiFetch } from "../api/client";
import { formatPhoneInput } from "../lib/phone";
import { Select, TextInput } from "../ui/Field";
import type { FormAction, FormFields } from "./formState";
import { LoadError } from "./LoadError";
import type { Step1Errors } from "./validation";

/** Property and unit, then the tenant's name, phone, and email. `staff` words it for someone filling it in for a tenant. */
export function LocationContactFields({
  fields,
  errors,
  dispatch,
  staff = false,
}: {
  fields: FormFields;
  errors: Step1Errors;
  dispatch: ActionDispatch<[FormAction]>;
  staff?: boolean;
}) {
  // Staff fill this in for someone else, so their browser must not offer their own details.
  const autoComplete = (value: string) => (staff ? "off" : value);
  const properties = useQuery({
    queryKey: ["public", "properties"],
    queryFn: () =>
      apiFetch<{ id: number; name: string }[]>("/api/public/properties"),
  });
  const units = useQuery({
    queryKey: ["public", "properties", fields.property_id, "units"],
    queryFn: () =>
      apiFetch<{ id: number; label: string }[]>(
        `/api/public/properties/${fields.property_id}/units`,
      ),
    enabled: !!fields.property_id,
  });
  const noUnits = units.data?.length === 0;

  return (
    <div className="space-y-4">
      <Select
        label="Property"
        name="property_id"
        value={fields.property_id}
        disabled={!properties.data}
        error={errors.property_id}
        onChange={(event) =>
          dispatch({
            type: "set",
            field: "property_id",
            value: event.target.value,
          })
        }
      >
        <option value="">
          {properties.isPending
            ? "Loading properties"
            : staff
              ? "Choose a property"
              : "Choose your property"}
        </option>
        {properties.data?.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </Select>
      {properties.isError && !properties.data && (
        <LoadError
          what="the property list"
          retrying={properties.isFetching}
          onRetry={() => void properties.refetch()}
        />
      )}

      <Select
        label="Unit"
        name="unit_id"
        value={fields.unit_id}
        disabled={!units.data}
        error={
          noUnits
            ? staff
              ? "No units listed for this property"
              : "No units listed. Please call us"
            : errors.unit_id
        }
        onChange={(event) =>
          dispatch({ type: "set", field: "unit_id", value: event.target.value })
        }
      >
        <option value="">
          {!fields.property_id
            ? "Choose a property first"
            : units.isPending
              ? "Loading units"
              : staff
                ? "Choose a unit"
                : "Choose your unit"}
        </option>
        {units.data?.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </Select>
      {units.isError && !units.data && (
        <LoadError
          what="the unit list"
          retrying={units.isFetching}
          onRetry={() => void units.refetch()}
        />
      )}

      <TextInput
        label={staff ? "Tenant name" : "Your name"}
        name="tenant_name"
        autoComplete={autoComplete("name")}
        maxLength={200}
        value={fields.tenant_name}
        error={errors.tenant_name}
        onChange={(event) =>
          dispatch({
            type: "set",
            field: "tenant_name",
            value: event.target.value,
          })
        }
      />
      <TextInput
        label="Phone"
        hint={
          staff
            ? "A phone number, an email, or both."
            : "Give us a phone number, an email, or both."
        }
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete("tel")}
        value={fields.phone}
        error={errors.phone}
        onChange={(event) =>
          dispatch({
            type: "set",
            field: "phone",
            value: formatPhoneInput(event.target.value),
          })
        }
      />
      <TextInput
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete={autoComplete("email")}
        maxLength={254}
        value={fields.email}
        error={errors.email}
        onChange={(event) =>
          dispatch({ type: "set", field: "email", value: event.target.value })
        }
      />
    </div>
  );
}
