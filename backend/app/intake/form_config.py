from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

FORM_CONFIG_PATH = Path(__file__).with_name("form_config.json")

MAX_TEXT_ANSWER = 500
# Where a self-check may be attached, by category. None means any answer in that category.
SELF_CHECK_ANSWERS = {"ac_heating": None, "electrical": None, "plumbing": {"clogged_drain"}}


class SelfCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    pending_client_approval: bool


class Option(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str = Field(min_length=1)
    label: str = Field(min_length=1)
    urgent: bool = False
    self_check: SelfCheck | None = None


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    type: Literal["single_choice", "text"]
    required: bool
    options: list[Option] = []

    @model_validator(mode="after")
    def options_fit_the_type(self):
        values = [option.value for option in self.options]
        if self.type == "text" and values:
            raise ValueError("A text question cannot have options")
        if self.type == "single_choice" and (len(values) < 2 or len(values) != len(set(values))):
            raise ValueError("A choice question needs at least two options with unique values")
        return self


class Category(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    questions: list[Question] = Field(min_length=2, max_length=4)

    @model_validator(mode="after")
    def questions_are_valid(self):
        ids = [question.id for question in self.questions]
        if len(ids) != len(set(ids)):
            raise ValueError("Question ids must be unique within a category")
        allowed = SELF_CHECK_ANSWERS.get(self.id, ())
        for question in self.questions:
            for option in question.options:
                if option.self_check and allowed is not None and option.value not in allowed:
                    raise ValueError("A self-check is not allowed on this answer")
        return self

    def answer_errors(self, answers: dict[str, str]) -> list[dict]:
        """Returns errors in the shape RequestValidationError takes. Never includes the answers."""
        location = ("body", "followup_answers")
        errors = []
        if answers.keys() - {question.id for question in self.questions}:
            errors.append({"loc": location, "msg": "Unknown question"})
        for question in self.questions:
            answer = answers.get(question.id)
            loc = (*location, question.id)
            if answer is None:
                if question.required:
                    errors.append({"loc": loc, "msg": "This question is required"})
            elif question.type == "single_choice":
                if answer not in {option.value for option in question.options}:
                    errors.append({"loc": loc, "msg": "Unknown option"})
            # Postgres cannot store NUL, so it would otherwise be a 500.
            elif len(answer) > MAX_TEXT_ANSWER or "\x00" in answer:
                errors.append({"loc": loc, "msg": "Invalid answer"})
        return errors

    def chosen_options(self, answers: dict[str, str]) -> list[Option]:
        return [
            option
            for question in self.questions
            for option in question.options
            if answers.get(question.id) == option.value
        ]


class FormConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    emergency_number: str = Field(min_length=1)
    # Here rather than in the environment, because the frontend reads it to show the checkbox.
    require_emergency_ack: bool
    categories: list[Category] = Field(min_length=1)

    @field_validator("categories")
    @classmethod
    def category_ids_are_unique(cls, categories: list[Category]) -> list[Category]:
        ids = [category.id for category in categories]
        if len(ids) != len(set(ids)):
            raise ValueError("Category ids must be unique")
        return categories


def load_form_config(path: Path) -> FormConfig:
    return FormConfig.model_validate_json(path.read_text(encoding="utf-8"))
