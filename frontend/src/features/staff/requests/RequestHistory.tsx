import { useState } from "react";
import { formatDateTime } from "../../../shared/lib/dates";
import { Button } from "../../../shared/ui/Button";
import { describeEvent } from "./historyCopy";
import type { HistoryEntry } from "./useRequest";

const LATEST = 5;

/** Newest first, as the server sends them. Requests from before history began have no events. */
export function RequestHistory({ history }: { history: HistoryEntry[] }) {
  const [all, setAll] = useState(false);
  if (!history.length) return <p>No history yet.</p>;
  const shown = all ? history : history.slice(0, LATEST);
  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {shown.map((entry) => (
          <li key={entry.id} className="border-l-4 border-gray-300 pl-3">
            <p>{describeEvent(entry)}</p>
            <p className="text-sm text-gray-700">
              <time dateTime={entry.created_at}>
                {formatDateTime(entry.created_at)}
              </time>
            </p>
          </li>
        ))}
      </ol>
      {history.length > LATEST && !all && (
        <Button onClick={() => setAll(true)}>
          Show all ({history.length})
        </Button>
      )}
    </div>
  );
}
