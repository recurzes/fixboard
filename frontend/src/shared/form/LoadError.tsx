import { Button } from "../ui/Button";
import { EmergencyLink } from "../ui/ErrorScreen";
import { Alert } from "../ui/Feedback";

/** Tenants get the number in the message itself. Staff have no number to call. */
export function LoadError({
  what,
  retrying,
  onRetry,
  staff = false,
}: {
  what: string;
  retrying: boolean;
  onRetry: () => void;
  staff?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Alert variant="error">
        We can't load {what} right now.
        {!staff && (
          <>
            {" "}
            If you need help now, call <EmergencyLink />.
          </>
        )}
      </Alert>
      <Button loading={retrying} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
