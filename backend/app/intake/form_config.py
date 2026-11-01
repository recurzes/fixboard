from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator

FORM_CONFIG_PATH = Path(__file__).with_name("form_config.json")


class Category(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    label: str = Field(min_length=1)


class FormConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

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
