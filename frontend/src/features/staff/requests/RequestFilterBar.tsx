import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../shared/api/client";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Choice";
import { TextInput } from "../../../shared/ui/Field";
import { usePublicConfig } from "../../../shared/form/usePublicConfig";
import { STATUS_LABELS } from "./RequestBadges";
import { STATUSES } from "./requestFilters";
import type { RequestFilters } from "./requestFilters";

const SEARCH_DELAY_MS = 300;

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    // Back and Clear filters change the URL with no typing.
    setSynced(value);
    setText(value);
  }

  useEffect(() => {
    if (text.trim() === value) return;
    const timer = setTimeout(() => {
      // Set now, not when the URL renders: a Back before that render would otherwise look like no change.
      setSynced(text.trim());
      onChange(text.trim());
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);

  return (
    <TextInput
      label="Search"
      hint="Reference number, unit, or tenant name"
      type="search"
      name="q"
      maxLength={200}
      autoComplete="off"
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  );
}

/** In the page flow rather than floating, so it needs no outside-click or Escape handling. */
function MultiFilter<T extends string>({
  label,
  options,
  selected,
  empty,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  empty?: string;
  onChange: (selected: T[]) => void;
}) {
  return (
    <details className="rounded-lg border border-gray-500">
      <summary className="min-h-11 cursor-pointer rounded-lg px-3 py-2.5 font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700">
        {label}
        {selected.length > 0 && ` (${selected.length})`}
      </summary>
      <div
        role="group"
        aria-label={label}
        className="max-h-64 overflow-y-auto border-t border-gray-300 px-3 py-1"
      >
        {options.length === 0 && <p className="py-2 text-gray-700">{empty}</p>}
        {options.map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={selected.includes(option.value)}
            onChange={() =>
              onChange(
                selected.includes(option.value)
                  ? selected.filter((value) => value !== option.value)
                  : [...selected, option.value],
              )
            }
          />
        ))}
      </div>
    </details>
  );
}

const unavailable = (failed: boolean) =>
  failed ? "We can't load this list right now." : "Loading";

export function RequestFilterBar({
  filters,
  active,
  update,
  onClear,
}: {
  filters: RequestFilters;
  active: boolean;
  update: (change: Partial<RequestFilters>, replace?: boolean) => void;
  onClear: () => void;
}) {
  const config = usePublicConfig();
  // No staff endpoint exists, and this one hides inactive properties, so their old requests can't be picked here.
  const properties = useQuery({
    queryKey: ["public", "properties"],
    queryFn: () =>
      apiFetch<{ id: number; name: string }[]>("/api/public/properties"),
  });

  return (
    <div className="space-y-3">
      {/* Replaces, so Back doesn't step through every search typed. */}
      <SearchBox value={filters.q} onChange={(q) => update({ q }, true)} />
      <div className="grid items-start gap-2 md:grid-cols-3">
        <MultiFilter
          label="Status"
          options={STATUSES.map((status) => ({
            value: status,
            label: STATUS_LABELS[status],
          }))}
          selected={filters.status}
          onChange={(status) => update({ status })}
        />
        <MultiFilter
          label="Property"
          options={(properties.data ?? []).map(({ id, name }) => ({
            value: String(id),
            label: name,
          }))}
          selected={filters.property}
          empty={unavailable(properties.isError)}
          onChange={(property) => update({ property })}
        />
        <MultiFilter
          label="Category"
          options={(config.data?.categories ?? []).map(({ id, label }) => ({
            value: id,
            label,
          }))}
          selected={filters.category}
          empty={unavailable(config.isError)}
          onChange={(category) => update({ category })}
        />
      </div>
      <div className="flex flex-wrap items-end gap-x-6">
        <Checkbox
          label="Show Done"
          hint={
            filters.status.length
              ? "Not used while a status is selected."
              : undefined
          }
          disabled={filters.status.length > 0}
          checked={filters.include_done}
          onChange={(event) => update({ include_done: event.target.checked })}
        />
        <Checkbox
          label="Needs review"
          checked={filters.needs_review}
          onChange={(event) => update({ needs_review: event.target.checked })}
        />
        <Checkbox
          label="Urgent"
          checked={filters.urgent}
          onChange={(event) => update({ urgent: event.target.checked })}
        />
        <Button className="mb-1" disabled={!active} onClick={onClear}>
          Clear filters
        </Button>
      </div>
    </div>
  );
}
