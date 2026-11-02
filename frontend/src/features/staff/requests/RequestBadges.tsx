import { Badge } from "../../../shared/ui/Feedback";
import type { RequestStatus } from "./requestFilters";
import type { RequestRow } from "./useRequests";

export const STATUS_LABELS: Record<RequestStatus, string> = {
  new: "New",
  scheduled: "Scheduled",
  waiting_on_vendor: "Waiting on vendor",
  done: "Done",
};

export function RequestBadges({ request }: { request: RequestRow }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={request.status === "new" ? "strong" : "neutral"}>
        {STATUS_LABELS[request.status]}
      </Badge>
      {request.urgent && <Badge tone="error">Urgent</Badge>}
      {request.needs_review && <Badge tone="warning">Needs review</Badge>}
    </span>
  );
}
