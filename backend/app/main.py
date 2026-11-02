from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.errors import register_error_handlers
from app.intake.form_config import FORM_CONFIG_PATH, load_form_config
from app.intake.routes import router as intake_router
from app.log import RequestLogMiddleware, configure_logging
from app.middleware import BodyLimitMiddleware, ReferrerPolicyMiddleware
from app.sentry import init_sentry
from app.settings import settings
from app.staff.routes import router as staff_router


def create_app(form_config_path: Path = FORM_CONFIG_PATH) -> FastAPI:
    configure_logging()
    init_sentry(settings.sentry_dsn)

    # No docs routes, because only health, config, properties, and units may be read publicly.
    app = FastAPI(title="Fixboard", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.form_config = load_form_config(form_config_path)
    # The last one added runs first, so the log sees everything and CORS covers a 413.
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.app_origin],
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )
    app.add_middleware(ReferrerPolicyMiddleware)
    app.add_middleware(RequestLogMiddleware)
    register_error_handlers(app)
    app.include_router(intake_router)
    app.include_router(staff_router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
