import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { flushSync } from "react-dom";
import { apiFetch } from "../../../shared/api/client";
import type { ApiError } from "../../../shared/api/client";
import { Button } from "../../../shared/ui/Button";
import { Alert, Badge, EmptyState, Spinner } from "../../../shared/ui/Feedback";
import { TextInput } from "../../../shared/ui/Field";
import { Modal } from "../../../shared/ui/Modal";
import { Toast, useToast } from "../../../shared/ui/Toast";
import type { ToastMessage } from "../../../shared/ui/Toast";
import type { Assignee } from "../requests/useAssignees";

type ShowToast = (text: string, variant?: ToastMessage["variant"]) => void;
type Save = ReturnType<typeof useSaveAssignee>;

const KIND_LABELS: Record<Assignee["kind"], string> = {
  in_house: "In-house",
  outside_vendor: "Outside vendor",
};

/** Add with no id, change with one. Every change refreshes the pickers, and the requests, which show assignee names through a join. */
function useSaveAssignee() {
  const queryClient = useQueryClient();
  return useMutation<
    Assignee,
    ApiError,
    { id?: number; name?: string; active?: boolean }
  >({
    mutationFn: ({ id, ...body }) =>
      apiFetch<Assignee>(`/api/staff/assignees${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        body,
      }),
    onSuccess: () => {
      for (const key of ["assignees", "requests", "request"]) {
        void queryClient.invalidateQueries({ queryKey: ["staff", key] });
      }
    },
  });
}

function nameError(error: ApiError | null) {
  if (!error) return undefined;
  // Names match with exact case, and a deactivated name stays taken.
  if (error.status === 409) {
    return "Another entry, active or not, already has this name.";
  }
  if (error.status === 422) return "Enter a name of up to 200 characters.";
  return "Couldn't save. Try again.";
}

function NameForm({
  label,
  initial = "",
  submitLabel,
  save,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: string;
  submitLabel: string;
  save: Save;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial);
  const [empty, setEmpty] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Focus takes a screen reader to the error, which is linked to the input.
  useEffect(() => {
    if (save.error) input.current?.focus();
  }, [save.error]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) return onSubmit(name);
    flushSync(() => setEmpty(true));
    input.current?.focus();
  };

  return (
    <form noValidate onSubmit={submit} className="space-y-2">
      <TextInput
        ref={input}
        label={label}
        maxLength={200}
        // Only a click on Rename opens this, and it means to type straight away.
        autoFocus={!!onCancel}
        value={name}
        error={empty ? "Enter a name" : nameError(save.error)}
        onChange={(event) => {
          setName(event.target.value);
          setEmpty(false);
          save.reset();
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button disabled={save.isPending} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function AddVendor({ showToast }: { showToast: ShowToast }) {
  const add = useSaveAssignee();
  // A new key empties the form after each add.
  const [added, setAdded] = useState(0);
  return (
    <section className="max-w-lg rounded-lg border border-gray-300 p-4">
      <NameForm
        key={added}
        label="Add an outside vendor"
        submitLabel="Add vendor"
        save={add}
        onSubmit={(name) =>
          add.mutate(
            { name },
            {
              onSuccess: (saved) => {
                showToast(`Added ${saved.name}`);
                setAdded((count) => count + 1);
              },
            },
          )
        }
      />
    </section>
  );
}

function VendorRow({
  assignee,
  showToast,
  onToggle,
}: {
  assignee: Assignee;
  showToast: ShowToast;
  onToggle: () => void;
}) {
  const rename = useSaveAssignee();
  const [renaming, setRenaming] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const stopRenaming = () => {
    flushSync(() => setRenaming(false));
    renameButton.current?.focus();
  };
  const { id, name, kind, active } = assignee;

  return (
    <tr className="border-t border-gray-300 align-top">
      <td className="py-3 pr-4">
        {renaming ? (
          <NameForm
            label={`New name for ${name}`}
            initial={name}
            submitLabel="Save"
            save={rename}
            onCancel={() => {
              rename.reset();
              stopRenaming();
            }}
            onSubmit={(newName) =>
              newName === name
                ? stopRenaming()
                : rename.mutate(
                    { id, name: newName },
                    {
                      onSuccess: (saved) => {
                        showToast(`Renamed to ${saved.name}`);
                        stopRenaming();
                      },
                    },
                  )
            }
          />
        ) : (
          <span className="font-medium break-words">{name}</span>
        )}
      </td>
      <td className="py-3 pr-4">{KIND_LABELS[kind]}</td>
      <td className="py-3 pr-4">
        <Badge tone={active ? "info" : "neutral"}>
          {active ? "Active" : "Inactive"}
        </Badge>
      </td>
      <td className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          {!renaming && (
            <Button ref={renameButton} onClick={() => setRenaming(true)}>
              Rename<span className="sr-only"> {name}</span>
            </Button>
          )}
          {kind === "in_house" ? (
            <p className="text-sm text-gray-700">
              Locked. In-house maintenance can't be deactivated, so there is
              always someone to assign.
            </p>
          ) : (
            <Button onClick={onToggle}>
              {active ? "Deactivate" : "Reactivate"}
              <span className="sr-only"> {name}</span>
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function ConfirmToggle({
  assignee,
  showToast,
  onClose,
}: {
  assignee: Assignee | null;
  showToast: ShowToast;
  onClose: () => void;
}) {
  const toggle = useSaveAssignee();
  const action = assignee?.active ? "Deactivate" : "Reactivate";
  const close = () => {
    toggle.reset();
    onClose();
  };
  return (
    <Modal
      open={!!assignee}
      onClose={close}
      title={`${action} ${assignee?.name}?`}
    >
      <p>
        {assignee?.active
          ? "It leaves the assignee picker. Requests already assigned to it keep it, and still show its name."
          : "It goes back into the assignee picker."}
      </p>
      {toggle.error && (
        <div className="mt-3">
          <Alert variant="error">Couldn't save. Try again.</Alert>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          loading={toggle.isPending}
          onClick={() =>
            toggle.mutate(
              { id: assignee!.id, active: !assignee!.active },
              {
                onSuccess: (saved) => {
                  showToast(
                    `${saved.name} ${saved.active ? "reactivated" : "deactivated"}`,
                  );
                  close();
                },
              },
            )
          }
        >
          {action}
        </Button>
        <Button disabled={toggle.isPending} onClick={close}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

export function VendorsPage() {
  const [toast, showToast] = useToast();
  const [toggling, setToggling] = useState<Assignee | null>(null);
  // Inactive entries too, or one could never be brought back.
  const assignees = useQuery({
    queryKey: ["staff", "assignees", "all"],
    queryFn: () =>
      apiFetch<Assignee[]>("/api/staff/assignees?include_inactive=true"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Vendors</h1>
      <AddVendor showToast={showToast} />
      {assignees.data?.length === 0 ? (
        // In-house maintenance is seeded, so this means the seed hasn't run.
        <EmptyState title="No vendors yet">
          Add an outside vendor above.
        </EmptyState>
      ) : assignees.data ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-sm text-gray-700">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Kind</th>
                <th className="py-2 pr-4 font-medium">State</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {assignees.data.map((assignee) => (
                <VendorRow
                  key={assignee.id}
                  assignee={assignee}
                  showToast={showToast}
                  onToggle={() => setToggling(assignee)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : assignees.isError ? (
        <div className="space-y-2">
          <Alert variant="error">
            We can't load the vendor list right now.
          </Alert>
          <Button
            loading={assignees.isFetching}
            onClick={() => void assignees.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : (
        <Spinner label="Loading vendors" />
      )}
      <ConfirmToggle
        assignee={toggling}
        showToast={showToast}
        onClose={() => setToggling(null)}
      />
      <Toast toast={toast} />
    </div>
  );
}
