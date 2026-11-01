from fastapi import FastAPI

from app.errors import register_error_handlers
from app.log import RequestLogMiddleware, configure_logging
from app.sentry import init_sentry
from app.settings import settings


def create_app() -> FastAPI:
    configure_logging()
    init_sentry(settings.sentry_dsn)

    app = FastAPI(title="Fixboard")
    app.add_middleware(RequestLogMiddleware)
    register_error_handlers(app)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
