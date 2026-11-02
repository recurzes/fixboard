import type { ActionDispatch } from "react";
import { Checkbox, RadioGroup } from "../../shared/ui/Choice";
import { EmergencyLink } from "../../shared/ui/ErrorScreen";
import { TextInput } from "../../shared/ui/Field";
import type { FormAction, FormFields } from "./formState";
import type { Category, Question, SelfCheck } from "./usePublicConfig";

type Dispatch = ActionDispatch<[FormAction]>;
type Errors = Record<string, string>;

export function IssueStep({
  categories,
  fields,
  errors,
  dispatch,
  onCategoryChange,
}: {
  categories: Category[];
  fields: FormFields;
  errors: Errors;
  dispatch: Dispatch;
  onCategoryChange: () => void;
}) {
  const category = categories.find(({ id }) => id === fields.category);
  return (
    <div className="space-y-4">
      <RadioGroup
        label="What kind of problem is it? (required)"
        options={categories.map(({ id, label }) => ({ value: id, label }))}
        value={fields.category}
        error={errors.category}
        onChange={(value) => {
          onCategoryChange();
          dispatch({ type: "set", field: "category", value });
        }}
      />
      {category && (
        <FollowUps
          category={category}
          fields={fields}
          errors={errors}
          dispatch={dispatch}
        />
      )}
    </div>
  );
}

function FollowUps({
  category,
  fields,
  errors,
  dispatch,
}: {
  category: Category;
  fields: FormFields;
  errors: Errors;
  dispatch: Dispatch;
}) {
  const chosen = ({ id, options }: Question) =>
    options.find(({ value }) => value === fields.followup_answers[id]);
  // Two urgent answers would say the same thing twice, so only the first shows it.
  const urgent = category.questions.find(
    (question) => chosen(question)?.urgent,
  );

  return category.questions.map((question) => {
    const label = `${question.label}${question.required ? " (required)" : ""}`;
    const value = fields.followup_answers[question.id] ?? "";
    const answer = (value: string) =>
      dispatch({ type: "answer", category, question: question.id, value });
    const selfCheck = chosen(question)?.self_check;
    return (
      <div key={question.id} className="space-y-2">
        {question.type === "text" ? (
          <TextInput
            label={label}
            name={question.id}
            maxLength={500}
            value={value}
            error={errors[question.id]}
            onChange={(event) => answer(event.target.value)}
          />
        ) : (
          <RadioGroup
            label={label}
            options={question.options}
            value={value}
            error={errors[question.id]}
            onChange={answer}
          />
        )}
        {question === urgent && <UrgentCallout />}
        {selfCheck && selfCheck.id === fields.self_check_shown && (
          <SelfCheckCard
            selfCheck={selfCheck}
            tried={fields.self_check_tried}
            dispatch={dispatch}
          />
        )}
      </div>
    );
  });
}

function UrgentCallout() {
  return (
    <div
      role="alert"
      className="rounded-lg border-2 border-red-700 bg-red-50 p-3"
    >
      <p className="text-lg font-bold">
        Please call <EmergencyLink /> now
      </p>
      <p>You can still send this request.</p>
    </div>
  );
}

function SelfCheckCard({
  selfCheck,
  tried,
  dispatch,
}: {
  selfCheck: SelfCheck;
  tried: boolean;
  dispatch: Dispatch;
}) {
  return (
    <div className="rounded-lg border border-gray-500 bg-gray-50 p-3">
      <h3 className="font-semibold">Something you can try</h3>
      <p className="my-2">{selfCheck.text}</p>
      <Checkbox
        label="I tried this"
        checked={tried}
        onChange={(event) =>
          dispatch({
            type: "set",
            field: "self_check_tried",
            value: event.target.checked,
          })
        }
      />
    </div>
  );
}
