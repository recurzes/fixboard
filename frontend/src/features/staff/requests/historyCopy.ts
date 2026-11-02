import { formatDateTime } from "../../../shared/lib/dates";
import { STATUS_LABELS } from "./RequestBadges";
import type { RequestStatus } from "./requestFilters";
import { SOURCE_LABELS } from "./useRequest";
import type { HistoryEntry, RequestSource } from "./useRequest";

const status = (value: string | null) =>
  STATUS_LABELS[value as RequestStatus] ?? value ?? "none";

/**
 * One event as a plain sentence. An automatic move to Scheduled is stored as an ordinary status change,
 * so it reads as one. A staff name is read when the request is loaded, so a rename changes old lines too.
 */
export function describeEvent(entry: HistoryEntry): string {
  const who = entry.actor_name ?? "The tenant";
  const { old_value: old, new_value: next } = entry;
  if (entry.event === "created") {
    const source = SOURCE_LABELS[next as RequestSource] ?? next;
    const verb = entry.actor_name ? "logged" : "submitted";
    return source
      ? `${who} ${verb} the request (${source})`
      : `${who} ${verb} the request`;
  }
  if (entry.event === "note_added") return `${who} added a note`;
  if (entry.event === "changed") {
    switch (entry.field) {
      case "status":
        return `${who} changed status from ${status(old)} to ${status(next)}`;
      case "assignee":
        if (!old) return `${who} assigned it to ${next}`;
        if (!next) return `${who} unassigned ${old}`;
        return `${who} changed the assignee from ${old} to ${next}`;
      case "scheduled_at":
        if (!old) return `${who} scheduled it for ${formatDateTime(next!)}`;
        if (!next) return `${who} cleared the scheduled time`;
        return `${who} rescheduled it from ${formatDateTime(old)} to ${formatDateTime(next)}`;
      case "needs_review":
        if (next === "false") return `${who} marked it as reviewed`;
    }
  }
  return `${who} made a change`;
}
