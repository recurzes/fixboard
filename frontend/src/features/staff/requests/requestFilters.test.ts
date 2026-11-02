import { expect, it } from "vitest";
import { parseFilters, serializeFilters } from "./requestFilters";
import type { RequestFilters } from "./requestFilters";

const NONE: RequestFilters = {
  property: [],
  status: [],
  category: [],
  needs_review: false,
  urgent: false,
  include_done: false,
  q: "",
};

const parse = (search: string) => parseFilters(new URLSearchParams(search));

it.each<[string, Partial<RequestFilters>, string]>([
  ["nothing", {}, ""],
  ["repeated keys", { property: ["1", "2"] }, "property=1&property=2"],
  [
    "every list",
    {
      property: ["3"],
      status: ["new", "done"],
      category: ["ac_heating", "pest"],
    },
    "property=3&status=new&status=done&category=ac_heating&category=pest",
  ],
  [
    "flags",
    { needs_review: true, urgent: true, include_done: true },
    "needs_review=true&urgent=true&include_done=true",
  ],
  ["spaces and symbols", { q: "Ana & Bo" }, "q=Ana+%26+Bo"],
])("round trips %s", (_, change, search) => {
  const filters = { ...NONE, ...change };
  expect(serializeFilters(filters).toString()).toBe(search);
  expect(parse(search)).toEqual(filters);
});

it.each([
  ["an unknown status", "status=closed"],
  ["a property that isn't an id", "property=abc"],
  ["property zero", "property=0"],
  ["a property id over the limit", "property=2147483648"],
  ["a cursor, which is never part of the page URL", "cursor=abc"],
  ["a flag that isn't true", "urgent=1&needs_review=false"],
  ["a search over 200 characters", `q=${"x".repeat(201)}`],
  ["a NUL in a search", "q=a%00b"],
  ["a NUL in a category", "category=a%00b"],
  ["a blank search", "q=%20%20"],
])("ignores %s", (_, search) => {
  expect(parse(search)).toEqual(NONE);
});

it("a selected status drops Show Done, because the backend would ignore it", () => {
  expect(parse("status=new&include_done=true")).toEqual({
    ...NONE,
    status: ["new"],
  });
  expect(
    serializeFilters({
      ...NONE,
      status: ["new"],
      include_done: true,
    }).toString(),
  ).toBe("status=new");
});

it("trims a search", () => {
  expect(parse("q=%20MR-1042%20").q).toBe("MR-1042");
  expect(serializeFilters({ ...NONE, q: " MR-1042 " }).toString()).toBe(
    "q=MR-1042",
  );
});
