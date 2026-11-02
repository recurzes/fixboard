import re

from sqlalchemy import MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.settings import settings

# Postgres raises on an id outside its integer range, which would turn a 404 or 422 into a 500.
MAX_ID = 2**31 - 1
# Everything Postgres adds after its one-line message.
_DB_ERROR_DETAILS = re.compile(r"\n(DETAIL|HINT|CONTEXT):.*", re.DOTALL)


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


# hide_parameters keeps tenant data out of SQL errors, and so out of logs and Sentry.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    hide_parameters=True,
    # psycopg's default is about two minutes, which would hold a worker thread through an outage.
    connect_args={"connect_timeout": 10},
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine, "handle_error")
def _drop_row_data_from_errors(context) -> None:
    # hide_parameters does not cover this: on a constraint failure, Postgres itself repeats the
    # whole row after DETAIL, including tenant fields that no scrubber could recognize.
    for error in (context.original_exception, context.sqlalchemy_exception):
        if error is not None and error.args and isinstance(error.args[0], str):
            error.args = (_DB_ERROR_DETAILS.sub("", error.args[0]), *error.args[1:])


def get_db():
    with SessionLocal() as session:
        yield session
