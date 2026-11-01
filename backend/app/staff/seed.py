"""Creates a staff account: python -m app.staff.seed --name "Sam Lee" --email sam@example.com

Needs SUPABASE_SERVICE_KEY. The password is asked for at a prompt, so it stays out of shell history.
"""

import argparse
import json
from getpass import getpass
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.settings import settings
from app.staff.models import StaffUser


def create_auth_user(email: str, password: str) -> UUID:
    key = settings.supabase_service_key
    if not key:
        raise SystemExit("SUPABASE_SERVICE_KEY is not set")
    request = Request(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
        data=json.dumps({"email": email, "password": password, "email_confirm": True}).encode(),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=10) as response:
            return UUID(json.load(response)["id"])
    except HTTPError as error:
        body = error.read().decode(errors="replace")
        raise SystemExit(f"Supabase refused the account: {error.code} {body}") from None


def create_staff(session: Session, name: str, email: str, password: str) -> None:
    name, email = name.strip(), email.strip().lower()
    if not name:
        raise SystemExit("Name is required")
    if session.scalar(select(StaffUser.id).where(StaffUser.email == email)):
        raise SystemExit("A staff user with this email already exists")
    # shortcut: if the insert then fails, the Supabase account stays behind with no staff row.
    # It can only get 403s. Delete it in the Supabase dashboard, then re-run.
    auth_id = create_auth_user(email, password)
    session.add(StaffUser(name=name, email=email, auth_id=auth_id))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a staff account")
    parser.add_argument("--name", required=True)
    parser.add_argument("--email", required=True)
    args = parser.parse_args()

    with SessionLocal.begin() as session:
        create_staff(session, args.name, args.email, getpass("Password: "))
    print("Staff account created")
