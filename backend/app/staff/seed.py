"""Creates a staff account: python -m app.staff.seed --name "Sam Lee" --email sam@example.com

Needs NEON_API_KEY, NEON_PROJECT_ID and NEON_BRANCH_ID. Neon's API takes no password, so the new
user sets one through the forgot-password flow.
"""

import argparse
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.settings import settings
from app.staff.models import StaffUser


def create_auth_user(email: str, name: str) -> UUID:
    key, project, branch = settings.neon_api_key, settings.neon_project_id, settings.neon_branch_id
    if not (key and project and branch):
        raise SystemExit("NEON_API_KEY, NEON_PROJECT_ID and NEON_BRANCH_ID must be set")
    request = Request(
        f"https://console.neon.tech/api/v2/projects/{project}/branches/{branch}/auth/users",
        data=json.dumps({"email": email, "name": name}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=10) as response:
            return UUID(json.load(response)["id"])
    except HTTPError as error:
        body = error.read().decode(errors="replace")
        raise SystemExit(f"Neon refused the account: {error.code} {body}") from None


def create_staff(session: Session, name: str, email: str) -> None:
    name, email = name.strip(), email.strip().lower()
    if not name:
        raise SystemExit("Name is required")
    if session.scalar(select(StaffUser.id).where(StaffUser.email == email)):
        raise SystemExit("A staff user with this email already exists")
    # shortcut: if the insert then fails, the Neon Auth account stays behind with no staff row.
    # It can only get 403s. Delete it in the Neon console, then re-run.
    auth_id = create_auth_user(email, name)
    session.add(StaffUser(name=name, email=email, auth_id=auth_id))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a staff account")
    parser.add_argument("--name", required=True)
    parser.add_argument("--email", required=True)
    args = parser.parse_args()

    with SessionLocal.begin() as session:
        create_staff(session, args.name, args.email)
    print("Staff account created")
