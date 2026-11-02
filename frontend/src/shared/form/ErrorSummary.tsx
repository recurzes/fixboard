import { Alert } from "../ui/Feedback";

/** Every problem at the top of the form, so a screen reader hears them all, not only the focused field's. */
export function ErrorSummary({ errors }: { errors: Record<string, string> }) {
  const entries = Object.entries(errors);
  if (!entries.length) return null;
  return (
    <Alert
      variant="error"
      word={entries.length === 1 ? "1 problem" : `${entries.length} problems`}
    >
      <ul className="mt-1 list-disc pl-5">
        {entries.map(([key, message]) => (
          <li key={key}>{message}</li>
        ))}
      </ul>
    </Alert>
  );
}
