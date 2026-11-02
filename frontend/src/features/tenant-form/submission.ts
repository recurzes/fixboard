import type { FieldError } from "../../shared/api/client";
import type { FormFields } from "./formState";

/** The multipart body of POST /api/public/requests. Lists each field, so nothing else can be sent. */
export function buildSubmission(fields: FormFields, photos: File[]) {
  const body = new FormData();
  body.append(
    "data",
    JSON.stringify({
      unit_id: Number(fields.unit_id),
      tenant_name: fields.tenant_name,
      phone: fields.phone,
      email: fields.email,
      category: fields.category,
      description: fields.description,
      entry_permission: fields.entry_permission,
      entry_notes: fields.entry_notes.trim() || null,
      followup_answers: fields.followup_answers,
      self_check_tried: fields.self_check_tried,
      not_an_emergency: fields.not_an_emergency,
      website: fields.website,
    }),
  );
  photos.forEach((photo) => body.append("photos", photo));
  return body;
}

/** Not crypto.randomUUID(), which only exists on HTTPS or localhost, and so not on a phone testing over a local IP. */
export function newIdempotencyKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// Our own copy, because some server messages carry Pydantic's "Value error, " prefix.
const PLACES: Record<string, [step: number, key: string, message: string]> = {
  // The server's phone-or-email rule names no field.
  body: [1, "phone", "Phone or email is required"],
  "body.unit_id": [1, "unit_id", "Choose your unit again"],
  "body.tenant_name": [1, "tenant_name", "Enter your name"],
  "body.phone": [1, "phone", "Enter a 10-digit US phone number"],
  "body.email": [1, "email", "Enter a valid email address"],
  "body.category": [2, "category", "Choose the kind of problem again"],
  "body.followup_answers": [2, "category", "Choose the kind of problem again"],
  "body.description": [3, "description", "Describe the problem"],
  "body.entry_permission": [3, "entry_permission", "Choose when we can enter"],
  "body.entry_notes": [3, "entry_notes", "Shorten these notes"],
  "body.not_an_emergency": [
    3,
    "not_an_emergency",
    "Confirm this is not an emergency",
  ],
  "body.photos": [3, "photos", "Remove some photos and try again."],
};

function place(field: string): [number, string, string] | undefined {
  const answer = field.match(/^body\.followup_answers\.(.+)$/);
  if (answer) return [2, answer[1], "Check this answer"];
  const photo = field.match(/^body\.photos\.(\d+)$/);
  if (photo) {
    const number = Number(photo[1]) + 1;
    return [
      3,
      "photos",
      `We couldn't use photo ${number}. Remove it, or choose a JPG or PNG.`,
    ];
  }
  return PLACES[field];
}

/** Sorts a 422's errors into the form's own keys, and the earliest step with one. Null if none are known. */
export function placeFieldErrors(fieldErrors: FieldError[]) {
  const errors: Record<string, string> = {};
  let step: number | null = null;
  for (const { field } of fieldErrors) {
    const known = place(field);
    if (!known) continue;
    const [errorStep, key, message] = known;
    errors[key] = errors[key] ? `${errors[key]} ${message}` : message;
    step = step === null ? errorStep : Math.min(step, errorStep);
  }
  return { step, errors };
}
