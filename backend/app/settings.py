from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(min_length=1)
    supabase_url: str = Field(min_length=1)
    supabase_service_key: str | None = None
    sentry_dsn: str | None = None


settings = Settings()
