import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, apiFetch } from "../../../shared/api/client";
import {
  formatDateTime,
  toLocalInput,
  toUtcIso,
} from "../../../shared/lib/dates";
import { siteConfig } from "../../../shared/lib/siteConfig";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Feedback";
import { Select, TextInput } from "../../../shared/ui/Field";
import type { ToastMessage } from "../../../shared/ui/Toast";
import { STATUS_LABELS } from "./RequestBadges";
import { STATUSES } from "./requestFilters";
import type { RequestStatus } from "./requestFilters";
import { useAssignees } from "./useAssignees";
import type { RequestDetail } from "./useRequest";

type Draft = {
  status: RequestStatus;
  assignee_id: number | null;
  /** A `datetime-local` value on the company clock, or "" for none. */
  scheduled: string;
};

/** Leaving a field out means no change. Null unassigns or clears the time. */
type Patch = {
  status?: RequestStatus;
  assignee_id?: number | null;
  scheduled_at?: string | null;
  needs_review?: false;
};

const toDraft = (request: RequestDetail): Draft => ({
  status: request.status,
  assignee_id: request.assignee_id,
  scheduled: request.scheduled_at ? toLocalInput(request.scheduled_at) : "",
});

function changes(base: RequestDetail, draft: Draft): Patch {
  const saved = toDraft(base);
  const patch: Patch = {};
  if (draft.status !== saved.status) patch.status = draft.status;
  if (draft.assignee_id !== saved.assignee_id) {
    patch.assignee_id = draft.assignee_id;
  }
  if (draft.scheduled !== saved.scheduled) {
    patch.scheduled_at = draft.scheduled ? toUtcIso(draft.scheduled) : null;
  }
  return patch;
}

/** The draft, and saves that carry the `updated_at` the draft started from, so nobody overwrites anyone silently. */
export function useRequestChanges(
  id: string,
  request: RequestDetail,
  showToast: (text: string, variant?: ToastMessage["variant"]) => void,
) {
  const queryClient = useQueryClient();
  const [base, setBase] = useState(request);
  const [draft, setDraft] = useState(() => toDraft(request));
  const [conflict, setConflict] = useState<Patch | null>(null);
  const patch = changes(base, draft);
  const dirty = Object.keys(patch).length > 0;
  // With nothing to lose, take the newest copy, such as the reload after a 409.
  if (!dirty && request !== base) {
    setBase(request);
    setDraft(toDraft(request));
  }

  const save = useMutation({
    // updated_at stays the server's string: a Date drops the microseconds, and every save would 409.
    mutationFn: (body: Patch) =>
      apiFetch<RequestDetail>(`/api/staff/requests/${id}`, {
        method: "PATCH",
        body: { ...body, updated_at: base.updated_at },
      }),
    onSuccess: (saved, body) => {
      queryClient.setQueryData(["staff", "request", id], saved);
      void queryClient.invalidateQueries({ queryKey: ["staff", "requests"] });
      void queryClient.invalidateQueries({ queryKey: ["staff", "summary"] });
      setBase(saved);
      // Mark as reviewed leaves the draft alone, so unsaved edits survive it.
      if (!("needs_review" in body)) setDraft(toDraft(saved));
      setConflict(null);
      showToast("Saved");
    },
    onError: (error, body) => {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(body);
        setDraft(toDraft(base));
        void queryClient.invalidateQueries({
          queryKey: ["staff", "request", id],
        });
        return;
      }
      const reason =
        error instanceof ApiError ? error.fields[0]?.message : undefined;
      showToast(`Couldn't save. ${reason ?? error.message}`, "error");
    },
  });

  return {
    base,
    draft,
    setDraft,
    dirty,
    conflict,
    save,
    saveDraft: () => save.mutate(patch),
    discard: () => setDraft(toDraft(base)),
  };
}

type Changes = ReturnType<typeof useRequestChanges>;

export function RequestChanges({ changes }: { changes: Changes }) {
  const { base, draft, setDraft, dirty, conflict, save } = changes;
  const assignees = useAssignees();
  const list = assignees.data ?? [];
  // A vendor deactivated since it was picked isn't in the list, but must still show, or a save could drop it.
  const keepCurrent =
    base.assignee_id !== null &&
    !list.some(({ id }) => id === base.assignee_id);
  const nameOf = (assigneeId: number | null) =>
    assigneeId === null
      ? "Unassigned"
      : (list.find(({ id }) => id === assigneeId)?.name ??
        (assigneeId === base.assignee_id ? base.assignee_name : null) ??
        `#${assigneeId}`);
  // The server only allows Waiting on vendor on a vendor, so a saved one proves its assignee is one.
  const isVendor = (assigneeId: number | null) =>
    list.find(({ id }) => id === assigneeId)?.kind === "outside_vendor" ||
    (assigneeId !== null &&
      assigneeId === base.assignee_id &&
      base.status === "waiting_on_vendor");
  const vendorChosen = isVendor(draft.assignee_id);
  // Only when the saved status is Waiting on vendor, because the assignee change below resets any other.
  const willMove = draft.status === "waiting_on_vendor" && !vendorChosen;

  const chooseAssignee = (value: string) => {
    const assigneeId = value ? Number(value) : null;
    setDraft((current) => ({
      ...current,
      assignee_id: assigneeId,
      // Sending Waiting on vendor with a non-vendor is refused, so drop back to the saved status and let the server move it.
      status:
        current.status === "waiting_on_vendor" && !isVendor(assigneeId)
          ? base.status
          : current.status,
    }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    changes.saveDraft();
  };
  const savingDraft = save.isPending && !("needs_review" in save.variables);

  return (
    <section className="rounded-lg border border-gray-300 p-4">
      <h2 className="mb-3 text-lg font-semibold">Status and assignment</h2>
      {conflict && (
        <div className="mb-3">
          <Alert variant="warning" word="Someone else changed this request">
            Your change wasn't saved, and the latest version is shown below. You
            tried to: {describe(conflict, nameOf).join("; ")}.
          </Alert>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Select
            label="Assignee"
            hint={
              assignees.isError ? "The vendor list didn't load." : undefined
            }
            value={draft.assignee_id ?? ""}
            onChange={(event) => chooseAssignee(event.target.value)}
          >
            <option value="">Unassigned</option>
            {keepCurrent && (
              <option value={base.assignee_id!}>{base.assignee_name}</option>
            )}
            <optgroup label="In-house">
              {list
                .filter(({ kind }) => kind === "in_house")
                .map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Outside vendors">
              {list
                .filter(({ kind }) => kind === "outside_vendor")
                .map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </optgroup>
          </Select>
          <Select
            label="Status"
            hint={
              willMove
                ? "Status will move to Scheduled, because the new assignee isn't an outside vendor."
                : vendorChosen
                  ? undefined
                  : "Waiting on vendor needs an outside vendor as the assignee."
            }
            value={draft.status}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                status: event.target.value as RequestStatus,
              }))
            }
          >
            {STATUSES.map((status) => (
              <option
                key={status}
                value={status}
                disabled={status === "waiting_on_vendor" && !vendorChosen}
              >
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
          <div>
            <TextInput
              label="Scheduled for"
              hint={`Company time (${siteConfig.timeZone})`}
              type="datetime-local"
              // The server takes 2000 to 2099 in UTC, so these stay a day inside.
              min="2000-01-02T00:00"
              max="2099-12-30T23:59"
              value={draft.scheduled}
              onChange={(event) => {
                const scheduled = event.target.value;
                setDraft((current) => ({ ...current, scheduled }));
              }}
            />
            <button
              type="button"
              disabled={!draft.scheduled}
              onClick={() =>
                setDraft((current) => ({ ...current, scheduled: "" }))
              }
              className="mt-1 min-h-11 font-semibold text-blue-800 underline focus-visible:outline-2 focus-visible:outline-blue-700 disabled:text-gray-500 disabled:no-underline"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!dirty} loading={savingDraft}>
            Save changes
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={changes.discard}>
            Discard
          </Button>
        </div>
      </form>
    </section>
  );
}

function describe(patch: Patch, nameOf: (id: number | null) => string | null) {
  const tried: string[] = [];
  if (patch.status)
    tried.push(`set the status to ${STATUS_LABELS[patch.status]}`);
  if (patch.assignee_id !== undefined) {
    tried.push(`assign it to ${nameOf(patch.assignee_id)}`);
  }
  if (patch.scheduled_at !== undefined) {
    tried.push(
      patch.scheduled_at
        ? `schedule it for ${formatDateTime(patch.scheduled_at)}`
        : "clear the scheduled time",
    );
  }
  if (patch.needs_review === false) tried.push("mark it as reviewed");
  return tried;
}
