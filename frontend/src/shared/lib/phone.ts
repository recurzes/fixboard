// Mirrors normalize_phone() in backend/app/phone.py: area codes never start with 0 or 1.
const US_PHONE =
  /^(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/;

export function isValidPhone(raw: string) {
  return US_PHONE.test(raw.trim());
}

/** Text that is not a US number comes back unchanged, so nothing is hidden from staff. */
export function formatPhone(raw: string) {
  const match = raw.trim().match(US_PHONE);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : raw;
}

// shortcut: the caret jumps to the end when editing mid-number, fix it if tenants complain.
export function formatPhoneInput(raw: string) {
  const digits = raw.replace(/\D/g, "").replace(/^1/, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
