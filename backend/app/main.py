from pathlib import Path

from fastapi import FastAPI

from app.errors import register_error_handlers
from app.intake.form_config import FORM_CONFIG_PATH, load_form_config
from app.intake.routes import router as intake_router
from app.log import RequestLogMiddleware, configure_logging
from app.sentry import init_sentry
from app.settings import settings


def create_app(form_config_path: Path = FORM_CONFIG_PATH) -> FastAPI:
    configure_logging()
    init_sentry(settings.sentry_dsn)

    app = FastAPI(title="Fixboard")
    app.state.form_config = load_form_config(form_config_path)
    app.add_middleware(RequestLogMiddleware)
    register_error_handlers(app)
    app.include_router(intake_router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
