import { isValidPhone } from "../../shared/lib/phone";
import type { FormFields } from "./formState";

// Same as _EMAIL in backend/app/requests/schemas.py, so the browser never refuses what the server accepts.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type Step1Errors = Partial<
  Record<"property_id" | "unit_id" | "tenant_name" | "phone" | "email", string>
>;

export function validateStep1(fields: FormFields) {
  const errors: Step1Errors = {};
  const phone = fields.phone.trim();
  const email = fields.email.trim();

  if (!fields.property_id) errors.property_id = "Choose your property";
  else if (!fields.unit_id) errors.unit_id = "Choose your unit";
  if (!fields.tenant_name.trim()) errors.tenant_name = "Enter your name";

  if (!phone && !email) errors.phone = "Phone or email is required";
  else if (phone && !isValidPhone(phone)) {
    errors.phone = "Enter a 10-digit US phone number";
  }
  if (email && !EMAIL.test(email)) errors.email = "Enter a valid email address";

  return errors;
}
