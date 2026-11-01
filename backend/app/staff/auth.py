from typing import Annotated
from urllib.parse import urlsplit
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient, PyJWKClientConnectionError, PyJWTError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.settings import settings
from app.staff.models import StaffUser

# Asymmetric only, so a token can never be verified with a shared secret.
ALGORITHMS = ["EdDSA"]
# Neon Auth sets both the issuer and the audience to the origin of the auth URL.
_auth_url = urlsplit(settings.neon_auth_url)
ORIGIN = f"{_auth_url.scheme}://{_auth_url.netloc}"

# shortcut: each token with an unknown kid refetches the key set, add a cooldown if abused.
jwks = PyJWKClient(f"{settings.neon_auth_url.rstrip('/')}/.well-known/jwks.json", timeout=5)
bearer = HTTPBearer(auto_error=False)

Db = Annotated[Session, Depends(get_db)]
Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


def _unauthorized() -> HTTPException:
    return HTTPException(401, "Invalid or missing token", {"WWW-Authenticate": "Bearer"})


def verify_token(token: str) -> UUID:
    """Returns the Neon Auth user id of a token with valid signature, expiry, issuer, audience."""
    try:
        key = jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=ALGORITHMS,
            audience=ORIGIN,
            issuer=ORIGIN,
            options={"require": ["exp", "aud", "iss", "sub"]},
        )
        return UUID(claims["sub"])
    except PyJWKClientConnectionError:
        # Our outage, not a bad token: a 401 here would sign every staff user out.
        raise HTTPException(503, "Sign-in service unavailable") from None
    except (PyJWTError, ValueError):
        raise _unauthorized() from None


def require_staff(credentials: Credentials, db: Db) -> StaffUser:
    if credentials is None:
        raise _unauthorized()
    auth_id = verify_token(credentials.credentials)
    staff = db.scalar(select(StaffUser).where(StaffUser.auth_id == auth_id, StaffUser.active))
    if staff is None:
        raise HTTPException(403, "Staff access only")
    return staff


CurrentStaff = Annotated[StaffUser, Depends(require_staff)]
