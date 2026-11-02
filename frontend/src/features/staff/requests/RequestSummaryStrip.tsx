import { Badge } from "../../../shared/ui/Feedback";
import { STATUS_LABELS } from "./RequestBadges";
import { STATUSES } from "./requestFilters";
import type { RequestFilters } from "./requestFilters";
import type { Summary } from "./useSummary";

/** The counts ignore every filter, so a chip matches its list only when nothing else is set. */
export function RequestSummaryStrip({
  summary,
  filters,
  update,
}: {
  summary: Summary;
  filters: RequestFilters;
  update: (change: Partial<RequestFilters>) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Request counts"
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      {STATUSES.map((status) => {
        const pressed =
          filters.status.length === 1 && filters.status[0] === status;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={pressed}
            onClick={() => update({ status: pressed ? [] : [status] })}
            className="min-h-11 cursor-pointer rounded-full border border-gray-500 px-3 font-medium hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700 aria-pressed:border-blue-900 aria-pressed:bg-blue-900 aria-pressed:text-white"
          >
            {STATUS_LABELS[status]} {summary.by_status[status]}
          </button>
        );
      })}
      <Badge tone="error">Open urgent {summary.open_urgent}</Badge>
      <Badge tone="warning">Needs review {summary.open_needs_review}</Badge>
    </div>
  );
}
