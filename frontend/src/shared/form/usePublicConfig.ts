import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

export type SelfCheck = {
  id: string;
  text: string;
  pending_client_approval: boolean;
};

export type Option = {
  value: string;
  label: string;
  urgent: boolean;
  self_check: SelfCheck | null;
};

export type Question = {
  id: string;
  label: string;
  type: "single_choice" | "text";
  required: boolean;
  options: Option[];
};

export type Category = { id: string; label: string; questions: Question[] };

export type PublicConfig = {
  emergency_number: string;
  require_emergency_ack: boolean;
  form_enabled: boolean;
  categories: Category[];
};

export function usePublicConfig() {
  return useQuery({
    queryKey: ["public", "config"],
    queryFn: () => apiFetch<PublicConfig>("/api/public/config"),
    // Changing the config needs a redeploy, so one fetch lasts the session.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
