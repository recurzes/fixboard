import { useSearchParams } from "react-router";
import { Button } from "../../../shared/ui/Button";
import { Alert, EmptyState } from "../../../shared/ui/Feedback";
import { RequestFilterBar } from "./RequestFilterBar";
import { parseFilters, serializeFilters } from "./requestFilters";
import type { RequestFilters } from "./requestFilters";
import { RequestRows } from "./RequestRows";
import { useRequests } from "./useRequests";

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

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Requests</h1>
      <RequestFilterBar
        filters={filters}
        active={active}
        update={update}
        onClear={clear}
      />
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
