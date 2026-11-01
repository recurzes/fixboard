import os

# app.settings reads this on import. Tests never connect, the engine is lazy.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost:5432/test")
