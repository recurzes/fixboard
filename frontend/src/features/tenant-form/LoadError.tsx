import { Button } from "../../shared/ui/Button";
import { Alert } from "../../shared/ui/Feedback";

/** Sits under the emergency banner, so the number stays on screen. */
export function LoadError({
  what,
  retrying,
  onRetry,
}: {
  what: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      <Alert variant="error">
        We can't load {what} right now. If you need help now, call the number
        above.
      </Alert>
      <Button loading={retrying} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
