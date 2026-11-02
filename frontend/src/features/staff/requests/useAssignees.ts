import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../../shared/api/client";

export type Assignee = {
  id: number;
  name: string;
  kind: "in_house" | "outside_vendor";
  active: boolean;
};

/** Active entries only. A request can still be on one deactivated since. */
export function useAssignees() {
  return useQuery({
    queryKey: ["staff", "assignees"],
    queryFn: () => apiFetch<Assignee[]>("/api/staff/assignees"),
  });
}
