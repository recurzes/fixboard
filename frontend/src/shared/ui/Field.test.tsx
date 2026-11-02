import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Checkbox, RadioGroup } from "./Choice";
import { Select, Textarea, TextInput } from "./Field";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

async function render(element: ReactElement) {
  const container = document.createElement("div");
  await act(async () => createRoot(container).render(element));
  return container;
}

const describedText = (control: Element, container: Element) =>
  control
    .getAttribute("aria-describedby")!
    .split(" ")
    .map((id) => container.querySelector(`[id="${id}"]`)!.textContent);

const text = { label: "Name", hint: "As on the lease", error: "Required" };

it.each([
  ["TextInput", <TextInput {...text} />, "input"],
  ["Select", <Select {...text} />, "select"],
  ["Textarea", <Textarea {...text} />, "textarea"],
])("%s links its label, hint, and error", async (_, element, tag) => {
  const container = await render(element);
  const control = container.querySelector<HTMLInputElement>(tag)!;
  expect(control.labels![0].textContent).toBe("Name");
  expect(control.getAttribute("aria-invalid")).toBe("true");
  expect(describedText(control, container)).toEqual([
    "As on the lease",
    "Required",
  ]);
});

it.each([
  ["TextInput", <TextInput label="Name" />, "input"],
  ["Select", <Select label="Name" />, "select"],
  ["Textarea", <Textarea label="Name" />, "textarea"],
])("%s without an error is not marked invalid", async (_, element, tag) => {
  const control = (await render(element)).querySelector(tag)!;
  expect(control.hasAttribute("aria-invalid")).toBe(false);
  expect(control.hasAttribute("aria-describedby")).toBe(false);
});

it("gives every radio the same name, which is what makes arrow keys work", async () => {
  const onChange = vi.fn();
  const container = await render(
    <RadioGroup
      {...text}
      value="a"
      onChange={onChange}
      options={[
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ]}
    />,
  );
  const radios = container.querySelectorAll<HTMLInputElement>("input");
  expect(radios[0].name).toBeTruthy();
  expect(radios[0].name).toBe(radios[1].name);
  expect(radios[0].checked).toBe(true);

  await act(async () => radios[1].click());
  expect(onChange).toHaveBeenCalledWith("b");

  const group = container.querySelector("fieldset")!;
  expect(group.getAttribute("aria-invalid")).toBe("true");
  expect(describedText(group, container)).toEqual([
    "As on the lease",
    "Required",
  ]);
});

it("links a checkbox's label and error", async () => {
  const container = await render(<Checkbox {...text} />);
  const box = container.querySelector("input")!;
  expect(box.labels![0].textContent).toBe("Name");
  expect(box.getAttribute("aria-invalid")).toBe("true");
  expect(describedText(box, container)).toEqual([
    "As on the lease",
    "Required",
  ]);
});
