import { expect, it } from "vitest";
import { describeEvent } from "./historyCopy";
import type { HistoryEntry } from "./useRequest";

const event = (change: Partial<HistoryEntry>): HistoryEntry => ({
  id: 1,
  event: "changed",
  field: null,
  old_value: null,
  new_value: null,
  actor_name: "Maria",
  created_at: "2026-11-02T15:00:00Z",
  ...change,
});

// Intl may use a narrow no-break space before AM or PM.
const copy = (change: Partial<HistoryEntry>) =>
  describeEvent(event(change)).replace(/\s/g, " ");

it.each<[Partial<HistoryEntry>, string]>([
  [
    {
      event: "created",
      field: "source",
      new_value: "tenant_form",
      actor_name: null,
    },
    "The tenant submitted the request (Tenant form)",
  ],
  [
    { event: "created", field: "source", new_value: "phone" },
    "Maria logged the request (Phone call)",
  ],
  [
    { event: "created", field: "source", new_value: "carrier_pigeon" },
    "Maria logged the request (carrier_pigeon)",
  ],
  [
    { field: "status", old_value: "new", new_value: "scheduled" },
    "Maria changed status from New to Scheduled",
  ],
  // An automatic move off Waiting on vendor is stored as a plain status change.
  [
    { field: "status", old_value: "waiting_on_vendor", new_value: "scheduled" },
    "Maria changed status from Waiting on vendor to Scheduled",
  ],
  [{ field: "assignee", new_value: "Plumber" }, "Maria assigned it to Plumber"],
  [
    { field: "assignee", old_value: "Plumber", new_value: "Electrician" },
    "Maria changed the assignee from Plumber to Electrician",
  ],
  [{ field: "assignee", old_value: "Plumber" }, "Maria unassigned Plumber"],
  [
    { field: "scheduled_at", new_value: "2026-11-03T19:00:00+00:00" },
    "Maria scheduled it for 11/03/2026, 2:00 PM",
  ],
  [
    {
      field: "scheduled_at",
      old_value: "2026-11-03T19:00:00+00:00",
      new_value: "2026-11-04T14:30:00+00:00",
    },
    "Maria rescheduled it from 11/03/2026, 2:00 PM to 11/04/2026, 9:30 AM",
  ],
  [
    { field: "scheduled_at", old_value: "2026-11-03T19:00:00+00:00" },
    "Maria cleared the scheduled time",
  ],
  [
    { field: "needs_review", old_value: "true", new_value: "false" },
    "Maria marked it as reviewed",
  ],
  [{ event: "note_added" }, "Maria added a note"],
  [
    { field: "priority", old_value: "low", new_value: "high" },
    "Maria made a change",
  ],
  [{ event: "archived" }, "Maria made a change"],
  [{ event: "archived", actor_name: null }, "The tenant made a change"],
])("%o reads %j", (change, sentence) => {
  expect(copy(change)).toBe(sentence);
});
