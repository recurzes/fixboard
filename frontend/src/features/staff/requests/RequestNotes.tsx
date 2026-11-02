import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { apiFetch } from "../../../shared/api/client";
import { formatDateTime } from "../../../shared/lib/dates";
import { Button } from "../../../shared/ui/Button";
import { Textarea } from "../../../shared/ui/Field";
import type { ToastMessage } from "../../../shared/ui/Toast";
import type { Note, RequestDetail } from "./useRequest";

/** Oldest first, as the server sends them. A note doesn't move `updated_at`, so others see it on their next load. */
export function RequestNotes({
  id,
  notes,
  showToast,
}: {
  id: string;
  notes: Note[];
  showToast: (text: string, variant?: ToastMessage["variant"]) => void;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: (text: string) =>
      apiFetch<Note>(`/api/staff/requests/${id}/notes`, {
        method: "POST",
        body: { body: text },
      }),
    onSuccess: (note) => {
      queryClient.setQueryData<RequestDetail>(
        ["staff", "request", id],
        (request) => request && { ...request, notes: [...request.notes, note] },
      );
      setBody("");
      showToast("Note added");
    },
    onError: (error) =>
      showToast(`Couldn't add the note. ${error.message}`, "error"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (body.trim()) add.mutate(body);
  };

  return (
    <div className="space-y-4">
      {notes.length ? (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="border-l-4 border-gray-300 pl-3">
              <p className="text-sm text-gray-700">
                {note.author_name} · {formatDateTime(note.created_at)}
              </p>
              <p className="break-words whitespace-pre-wrap">{note.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p>No notes yet.</p>
      )}
      <form onSubmit={submit} className="space-y-2">
        <Textarea
          label="Add a note"
          hint="Only staff can see notes."
          maxLength={5000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <Button type="submit" disabled={!body.trim()} loading={add.isPending}>
          Add note
        </Button>
      </form>
    </div>
  );
}
