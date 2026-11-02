import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../../shared/api/client";
import type { RequestStatus } from "./requestFilters";

export type Summary = {
  by_status: Record<RequestStatus, number>;
  open_urgent: number;
  open_needs_review: number;
};

const POLL_MS = 30_000;

/**
 * Call only from StaffLayout, which hands the data down: each call runs its own timer, so a second
 * one doubles the polling. TanStack Query skips the timer's calls while the tab is hidden.
 */
export function useSummary() {
  return useQuery({
    queryKey: ["staff", "summary"],
    queryFn: () => apiFetch<Summary>("/api/staff/requests/summary"),
    refetchInterval: POLL_MS,
  });
}
