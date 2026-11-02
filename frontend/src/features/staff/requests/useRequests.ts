import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "../../../shared/api/client";
import { serializeFilters } from "./requestFilters";
import type { RequestFilters, RequestStatus } from "./requestFilters";

export type RequestRow = {
  id: number;
  reference_number: string;
  property_id: number;
  property_name: string;
  unit_id: number;
  unit_label: string;
  tenant_name: string;
  category: string;
  status: RequestStatus;
  urgent: boolean;
  needs_review: boolean;
  assignee_id: number | null;
  assignee_name: string | null;
  scheduled_at: string | null;
  created_at: string;
};

type RequestPage = { items: RequestRow[]; next_cursor: string | null };

/** 25 rows a page, set by the server. The cursor is opaque and stays out of the page URL. */
export function useRequests(filters: RequestFilters) {
  const search = serializeFilters(filters).toString();
  return useInfiniteQuery({
    queryKey: ["staff", "requests", search],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(search);
      if (pageParam) params.set("cursor", pageParam);
      return apiFetch<RequestPage>(`/api/staff/requests?${params}`);
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  });
}
