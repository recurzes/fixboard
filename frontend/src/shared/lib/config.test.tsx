import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ConfigError } from "../../app/ConfigError";
import { findMissing } from "./config";

it("names each missing or empty variable", () => {
  expect(findMissing({ VITE_API_URL: "a", VITE_NEON_AUTH_URL: "" })).toEqual([
    "VITE_NEON_AUTH_URL",
  ]);
  expect(findMissing({ VITE_API_URL: "a", VITE_NEON_AUTH_URL: "b" })).toEqual(
    [],
  );
});

it("shows the missing variable on the error screen", () => {
  const html = renderToStaticMarkup(<ConfigError missing={["VITE_API_URL"]} />);
  expect(html).toContain("VITE_API_URL");
});
