import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RequestHistory } from "./RequestHistory";
import type { HistoryEntry } from "./useRequest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function render(history: HistoryEntry[]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<RequestHistory history={history} />));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

/** Newest first, as the server sends them: event n is n hours after 9 AM on November 2. */
const events = (count: number): HistoryEntry[] =>
  Array.from({ length: count }, (_, index) => {
    const n = count - index;
    return {
      id: n,
      event: "changed",
      field: "assignee",
      old_value: null,
      new_value: `Vendor ${n}`,
      actor_name: "Maria",
      created_at: new Date(Date.UTC(2026, 10, 2, 14 + n)).toISOString(),
    };
  });

const lines = (container: HTMLElement) =>
  [...container.querySelectorAll("li")].map((item) =>
    item.textContent!.replace(/\s/g, " "),
  );

it("keeps the server's newest-first order, with who and a US-style time", () => {
  const container = render(events(3));
  expect(lines(container)).toEqual([
    "Maria assigned it to Vendor 311/02/2026, 12:00 PM",
    "Maria assigned it to Vendor 211/02/2026, 11:00 AM",
    "Maria assigned it to Vendor 111/02/2026, 10:00 AM",
  ]);
});

it("shows the latest 5, and Show all reveals the rest", () => {
  const container = render(events(7));
  expect(lines(container)).toHaveLength(5);
  expect(lines(container)[0]).toContain("Vendor 7");

  const showAll = container.querySelector("button")!;
  expect(showAll.textContent).toBe("Show all (7)");
  act(() => showAll.click());

  expect(lines(container)).toHaveLength(7);
  expect(lines(container)[6]).toContain("Vendor 1");
  expect(container.querySelector("button")).toBeNull();
});

it("has no Show all with 5 or fewer, and says so when there is nothing", () => {
  expect(render(events(5)).querySelector("button")).toBeNull();
  expect(render([]).textContent).toBe("No history yet.");
});
