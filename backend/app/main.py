import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.errors import register_error_handlers
from app.intake.form_config import FORM_CONFIG_PATH, load_form_config
from app.intake.routes import Db, limiter
from app.intake.routes import router as intake_router
from app.log import RequestLogMiddleware, configure_logging
from app.middleware import BodyLimitMiddleware, ReferrerPolicyMiddleware
from app.photos import storage
from app.sentry import init_sentry
from app.settings import settings
from app.staff.routes import router as staff_router

logger = logging.getLogger(__name__)

PLACEHOLDER_EMERGENCY_NUMBER = "(000) 000-0000"


# Outside create_app, because slowapi adds the limit again each time this decorator runs.
# Limited because each call from the public internet reaches the database and the bucket.
@limiter.limit("30/minute")
def health_ready(request: Request, db: Db):
    try:
        db.execute(text("SELECT 1"))
        storage.check_bucket()
    except Exception:
        # A warning, so an outage does not send Sentry an event per check. The details stay here
        # because this route is public.
        logger.warning("readiness check failed", exc_info=True)
        raise HTTPException(503, "Not ready") from None
    return {"status": "ok"}


def create_app(form_config_path: Path = FORM_CONFIG_PATH) -> FastAPI:
    configure_logging()
    init_sentry(settings.sentry_dsn)

    # No docs routes, because only health, config, properties, and units may be read publicly.
    app = FastAPI(title="Fixboard", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.form_config = load_form_config(form_config_path)
    if app.state.form_config.emergency_number == PLACEHOLDER_EMERGENCY_NUMBER:
        logger.warning(
            "EMERGENCY NUMBER IS STILL THE PLACEHOLDER %s. TENANTS CANNOT REACH ANYONE WITH IT. "
            "Replace it in form_config.json before real tenants use the form.",
            PLACEHOLDER_EMERGENCY_NUMBER,
        )
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

    app.add_api_route("/health/ready", health_ready)

    return app


app = create_app()
