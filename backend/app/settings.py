from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(min_length=1)
    neon_auth_url: str = Field(min_length=1)
    neon_api_key: str | None = None
    neon_project_id: str | None = None
    neon_branch_id: str | None = None
    sentry_dsn: str | None = None


settings = Settings()
