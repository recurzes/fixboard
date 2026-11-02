import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../../shared/api/client";
import type { RequestRow } from "./useRequests";

export type EntryPermission = "anytime" | "notify_first" | "only_when_home";
export type RequestSource = "tenant_form" | "phone" | "text" | "in_person";

export const SOURCE_LABELS: Record<RequestSource, string> = {
  tenant_form: "Tenant form",
  phone: "Phone call",
  text: "Text message",
  in_person: "Walk-in",
};

export type Note = {
  id: number;
  body: string;
  author_name: string;
  created_at: string;
};

export type HistoryEntry = {
  id: number;
  event: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_name: string | null; // null means the tenant
  created_at: string;
};

export type RequestDetail = RequestRow & {
  phone: string | null; // E.164
  email: string | null;
  description: string;
  followup_answers: Record<string, string>;
  entry_permission: EntryPermission;
  entry_notes: string | null;
  source: RequestSource;
  contact_matched: boolean;
  self_check_shown: string | null;
  self_check_tried: boolean;
  emergency_ack_at: string | null;
  updated_at: string;
  photo_ids: number[];
  notes: Note[];
  history: HistoryEntry[]; // newest first
};

/** The backend answers an unknown id with 404, and a non-numeric one with 422. */
export const isNotFound = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

export function useRequest(id: string) {
  return useQuery({
    queryKey: ["staff", "request", id],
    queryFn: () => apiFetch<RequestDetail>(`/api/staff/requests/${id}`),
  });
}
