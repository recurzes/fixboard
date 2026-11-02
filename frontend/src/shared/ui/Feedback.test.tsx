import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Button } from "./Button";
import { Alert, Spinner } from "./Feedback";

it.each([
  ["info", "Info:"],
  ["warning", "Warning:"],
  ["error", "Error:"],
] as const)("the %s alert says so in words", (variant, word) => {
  expect(
    renderToStaticMarkup(<Alert variant={variant}>Hello</Alert>),
  ).toContain(word);
});

it("a spinner has text for screen readers", () => {
  expect(renderToStaticMarkup(<Spinner />)).toContain("Loading");
});

it("a loading button is locked and says it is busy", () => {
  const html = renderToStaticMarkup(<Button loading>Send</Button>);
  expect(html).toContain("disabled");
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("Loading");
});

it("a button does not submit a form unless asked to", () => {
  expect(renderToStaticMarkup(<Button>Next</Button>)).toContain(
    'type="button"',
  );
});
