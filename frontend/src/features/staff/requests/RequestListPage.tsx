import { useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import { Button } from "../../../shared/ui/Button";
import { Alert, EmptyState } from "../../../shared/ui/Feedback";
import { RequestFilterBar } from "./RequestFilterBar";
import { parseFilters, serializeFilters } from "./requestFilters";
import type { RequestFilters } from "./requestFilters";
import { RequestRows } from "./RequestRows";
import { RequestSummaryStrip } from "./RequestSummaryStrip";
import { useRequests } from "./useRequests";
import type { Summary } from "./useSummary";

const Skeleton = () => (
  <div role="status" className="space-y-2">
    <span className="sr-only">Loading requests</span>
    {[1, 2, 3, 4, 5].map((row) => (
      <div
        key={row}
        className="h-14 rounded-lg bg-gray-200 motion-safe:animate-pulse"
      />
    ))}
  </div>
);

export function RequestListPage() {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const active = serializeFilters(filters).toString() !== "";
  const requests = useRequests(filters);
  const rows = requests.data?.pages.flatMap((page) => page.items);

  const update = (change: Partial<RequestFilters>, replace = false) =>
    setParams(serializeFilters({ ...filters, ...change }), { replace });
  const clear = () => setParams({});
  // Search obeys the Done rule, so a Done request's reference finds nothing without this.
  const canAddDone =
    filters.q && !filters.status.length && !filters.include_done;

  const summary = useOutletContext<Summary | undefined>();
  const newCount = summary?.by_status.new;
  const [lastCount, setLastCount] = useState(newCount);
  const [arrived, setArrived] = useState(0);
  if (newCount !== lastCount) {
    setLastCount(newCount);
    // Rises only, because a triaged request lowers the count. Two arrivals and one triage between polls read as one, and the row highlight covers that.
    // shortcut: returning to the tab refreshes the list and the count together, so this can offer rows already showing. Upgrade if it confuses staff.
    if (
      lastCount !== undefined &&
      newCount !== undefined &&
      newCount > lastCount
    ) {
      setArrived(arrived + newCount - lastCount);
    }
  }
  const showArrivals = () => {
    setArrived(0);
    // A filter could hide the new request, and the button promises to show it.
    if (active) clear();
    else void requests.refetch();
  };

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Requests</h1>
      {summary && (
        <RequestSummaryStrip
          summary={summary}
          filters={filters}
          update={update}
        />
      )}
      <RequestFilterBar
        filters={filters}
        active={active}
        update={update}
        onClear={clear}
      />
      {arrived > 0 && (
        // Sticky, so staff far down the list still see it.
        <div className="sticky top-2 z-10 mt-4">
          <Alert variant="info">
            {arrived === 1 ? "1 new request." : `${arrived} new requests.`}{" "}
            <Button onClick={showArrivals}>
              {arrived === 1 ? "Show it" : "Show them"}
            </Button>
          </Alert>
        </div>
      )}
      <div className="mt-4">
        {/* Rows first, so a failed background refetch or Load more doesn't replace them. */}
        {rows?.length ? (
          <>
            <RequestRows rows={rows} />
            <div className="mt-4 space-y-2">
              {requests.isFetchNextPageError && (
                <Alert variant="error">
                  We can't load more requests right now.
                </Alert>
              )}
              {requests.hasNextPage && (
                <Button
                  loading={requests.isFetchingNextPage}
                  onClick={() => void requests.fetchNextPage()}
                >
                  Load more
                </Button>
              )}
            </div>
          </>
        ) : rows && active ? (
          <EmptyState title="No matches.">
            {canAddDone && (
              <p className="mb-2">This search doesn't include Done requests.</p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              {canAddDone && (
                <Button onClick={() => update({ include_done: true })}>
                  Search Done too
                </Button>
              )}
              <Button onClick={clear}>Clear filters</Button>
            </div>
          </EmptyState>
        ) : rows ? (
          <EmptyState title="No open requests" />
        ) : requests.isError ? (
          <div className="space-y-2">
            <Alert variant="error">We can't load requests right now.</Alert>
            <Button
              loading={requests.isFetching}
              onClick={() => void requests.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <Skeleton />
        )}
      </div>
    </>
  );
}
