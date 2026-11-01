from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(min_length=1)
    neon_auth_url: str = Field(min_length=1)
    neon_api_key: str | None = None
    neon_project_id: str | None = None
    neon_branch_id: str | None = None
    storage_endpoint_url: str = Field(min_length=1)
    storage_bucket: str = Field(min_length=1)
    storage_access_key_id: str = Field(min_length=1)
    storage_secret_access_key: str = Field(min_length=1)
    storage_region: str = "auto"
    sentry_dsn: str | None = None
    public_form_enabled: bool = True
    rate_limit_ip: str = "10/minute"
    rate_limit_unit_per_hour: int = 10


settings = Settings()
