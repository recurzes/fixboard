import { useState } from "react";
import type { ReactNode } from "react";
import { formatDate, formatDateTime } from "../shared/lib/dates";
import { formatPhone, formatPhoneInput } from "../shared/lib/phone";
import { siteConfig } from "../shared/lib/siteConfig";
import { Button } from "../shared/ui/Button";
import { Checkbox, RadioGroup } from "../shared/ui/Choice";
import { Alert, Badge, EmptyState, Spinner } from "../shared/ui/Feedback";
import { Select, Textarea, TextInput } from "../shared/ui/Field";
import { Modal } from "../shared/ui/Modal";

const OPTIONS = [
  { value: "a", label: "First option" },
  { value: "b", label: "Second option" },
  { value: "c", label: "Third option" },
];
const NOW = "2026-07-04T18:30:00Z";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

// Development only, see routes.tsx. Every shared control in every state.
export function UiDemo() {
  const [radio, setRadio] = useState("a");
  const [box, setBox] = useState(false);
  const [phone, setPhone] = useState("");
  const [modal, setModal] = useState(false);
  return (
    <main className="mx-auto max-w-lg space-y-8 p-4">
      <h1 className="text-2xl font-bold">UI demo</h1>

      <Section title="Button">
        <div className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="TextInput">
        <TextInput label="Default" />
        <TextInput label="With hint" hint="A hint" />
        <TextInput label="With error" hint="A hint" error="An error" />
        <TextInput label="Disabled" defaultValue="Can't change" disabled />
        <TextInput
          label="Phone, formats as you type"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
        />
      </Section>

      <Section title="Select">
        <Select label="Default">
          <option>First option</option>
        </Select>
        <Select label="With hint" hint="A hint">
          <option>First option</option>
        </Select>
        <Select label="With error" hint="A hint" error="An error">
          <option>First option</option>
        </Select>
        <Select label="Disabled" disabled>
          <option>First option</option>
        </Select>
      </Section>

      <Section title="Textarea">
        <Textarea label="Default" />
        <Textarea label="With hint" hint="A hint" />
        <Textarea label="With error" hint="A hint" error="An error" />
        <Textarea label="Disabled" defaultValue="Can't change" disabled />
      </Section>

      <Section title="RadioGroup">
        <RadioGroup
          label="Default"
          hint="Arrow keys move between options"
          options={OPTIONS}
          value={radio}
          onChange={setRadio}
        />
        <RadioGroup
          label="With error"
          hint="A hint"
          error="An error"
          options={OPTIONS}
          value=""
          onChange={() => {}}
        />
        <RadioGroup
          label="Disabled"
          options={OPTIONS}
          value="a"
          onChange={() => {}}
          disabled
        />
      </Section>

      <Section title="Checkbox">
        <Checkbox
          label="Default, space toggles"
          checked={box}
          onChange={(event) => setBox(event.target.checked)}
        />
        <Checkbox label="With hint" hint="A hint" />
        <Checkbox label="With error" error="An error" />
        <Checkbox label="Checked" defaultChecked />
        <Checkbox label="Disabled" disabled />
      </Section>

      <Section title="Alert">
        <Alert variant="info">Something to know.</Alert>
        <Alert variant="warning">Something to be careful of.</Alert>
        <Alert variant="error">Something went wrong.</Alert>
      </Section>

      <Section title="Spinner">
        <Spinner />
      </Section>

      <Section title="EmptyState">
        <EmptyState title="No open requests" />
        <EmptyState title="No matches">Clear filters to see more.</EmptyState>
      </Section>

      <Section title="Badge">
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="info">Info</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="error">Error</Badge>
          <Badge tone="strong">Strong</Badge>
        </div>
      </Section>

      <Section title="Modal">
        <Button onClick={() => setModal(true)}>Open modal</Button>
        <Modal open={modal} onClose={() => setModal(false)} title="A modal">
          <p className="mb-3">Tab stays inside. Esc closes it.</p>
          <Button onClick={() => setModal(false)}>Done</Button>
        </Modal>
      </Section>

      <Section title="Formats and config">
        <ul className="list-disc pl-6">
          <li>Phone: {formatPhone("+15551234567")}</li>
          <li>Date: {formatDate(NOW)}</li>
          <li>Date and time: {formatDateTime(NOW)}</li>
          <li>
            Emergency number: {siteConfig.emergencyNumber}
            {siteConfig.emergencyNumberIsPlaceholder && " (placeholder)"}
          </li>
          <li>Time zone: {siteConfig.timeZone} (placeholder)</li>
          <li>Privacy notice: {siteConfig.privacyNotice}</li>
          <li>Entry notice: {siteConfig.entryNotice}</li>
          <li>
            Photos: {siteConfig.maxPhotos}, up to{" "}
            {siteConfig.maxPhotoBytes / (1024 * 1024)} MB each
          </li>
        </ul>
      </Section>
    </main>
  );
}

export function DemoCrash(): ReactNode {
  throw new Error("Demo crash");
}
