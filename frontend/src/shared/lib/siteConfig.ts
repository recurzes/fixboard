// Built into the bundle so the number still shows when the API is down.
import { emergency_number } from "../../../../backend/app/intake/form_config.json";

const PLACEHOLDER_EMERGENCY_NUMBER = "(000) 000-0000";

export const siteConfig = {
  emergencyNumber: emergency_number,
  emergencyNumberIsPlaceholder:
    emergency_number === PLACEHOLDER_EMERGENCY_NUMBER,
  // Placeholders until the client confirms their US state (assumption A7).
  timeZone: "America/New_York",
  privacyNotice:
    "We use your contact details and photos only to handle this maintenance request.",
  entryNotice:
    "We will give you notice before entering your home unless it is an emergency.",
  // Mirrors MAX_PHOTOS and MAX_PHOTO_BYTES in backend/app/photos/images.py.
  maxPhotos: 5,
  maxPhotoBytes: 10 * 1024 * 1024,
};
