"""One run through both journeys against a live backend: uv run python tests/smoke.py <api url>

Submits a request with a photo, signs in as staff, checks the New count, changes the status, and
assigns a vendor. Any failed step stops the run with a non-zero exit code.

Reads NEON_AUTH_URL, APP_ORIGIN, SMOKE_STAFF_EMAIL, and SMOKE_STAFF_PASSWORD from the shell.

This writes real data, and history events cannot be deleted. Run it before real tenants arrive.
Its request is named "SMOKE TEST" and ends as Done, so it is off the default dashboard list.
"""

import argparse
import json
import os
import sys
from io import BytesIO
from uuid import uuid4

import httpx2
from PIL import Image

TENANT_NAME = "SMOKE TEST - please ignore"


def ok(response: httpx2.Response, status: int = 200) -> httpx2.Response:
    if response.status_code != status:
        # The path only, because a signed link's query string works as a password.
        path = response.request.url.path
        sys.exit(f"FAILED {response.request.method} {path}: {response.status_code} {response.text}")
    return response


def check(condition: bool, message: str) -> None:
    if not condition:
        sys.exit(f"FAILED {message}")
    print(f"ok: {message}")


def sign_in() -> str:
    auth_url = os.environ["NEON_AUTH_URL"].rstrip("/")
    # Neon Auth checks the Origin, and the client carries the session cookie to the second call.
    with httpx2.Client(timeout=30, headers={"Origin": os.environ["APP_ORIGIN"]}) as client:
        ok(
            client.post(
                f"{auth_url}/sign-in/email",
                json={
                    "email": os.environ["SMOKE_STAFF_EMAIL"],
                    "password": os.environ["SMOKE_STAFF_PASSWORD"],
                },
            )
        )
        token = ok(client.get(f"{auth_url}/get-session")).headers.get("set-auth-jwt")
    if not token:
        sys.exit("FAILED sign-in returned no token")
    return token


def jpeg() -> bytes:
    file = BytesIO()
    Image.new("RGB", (64, 64), "gray").save(file, "JPEG")
    return file.getvalue()


def submit(public: httpx2.Client, unit_id: int) -> str:
    data = {
        "unit_id": unit_id,
        "tenant_name": TENANT_NAME,
        "email": "smoke-test@example.com",
        "category": "pest",
        "description": "Automated smoke test, no action needed.",
        "entry_permission": "notify_first",
        "followup_answers": {"pest_type": "other", "frequency": "once"},
        "not_an_emergency": True,
    }
    response = public.post(
        "/api/public/requests",
        headers={"Idempotency-Key": str(uuid4())},
        data={"data": json.dumps(data)},
        files={"photos": ("smoke.jpg", jpeg(), "image/jpeg")},
    )
    return ok(response, 201).json()["reference_number"]


def run(api_url: str) -> None:
    public = httpx2.Client(base_url=api_url, timeout=60)
    ok(public.get("/health/ready"))
    print("ok: database and storage are ready")

    properties = ok(public.get("/api/public/properties")).json()
    check(bool(properties), "a property is on the form")
    units = ok(public.get(f"/api/public/properties/{properties[0]['id']}/units")).json()
    check(bool(units), "the property has a unit")

    staff = httpx2.Client(
        base_url=api_url, timeout=60, headers={"Authorization": f"Bearer {sign_in()}"}
    )
    ok(staff.get("/api/staff/me"))
    print("ok: signed in as staff")

    before = ok(staff.get("/api/staff/requests/summary")).json()["by_status"]["new"]
    reference = submit(public, units[0]["id"])
    print(f"ok: submitted {reference} with a photo")

    after = ok(staff.get("/api/staff/requests/summary")).json()["by_status"]["new"]
    # At least, because a real tenant may submit at the same moment.
    check(after >= before + 1, f"the New count went from {before} to {after}")

    rows = ok(staff.get("/api/staff/requests", params={"q": reference})).json()["items"]
    check(len(rows) == 1, "the search finds the request")
    path = f"/api/staff/requests/{rows[0]['id']}"
    detail = ok(staff.get(path)).json()
    check(len(detail["photo_ids"]) == 1, "the request has its photo")

    link = ok(staff.get(f"{path}/photos/{detail['photo_ids'][0]}")).json()["url"]
    check(httpx2.get(link, timeout=30).status_code == 200, "the signed link serves the photo")

    detail = ok(
        staff.patch(path, json={"updated_at": detail["updated_at"], "status": "scheduled"})
    ).json()
    check(detail["status"] == "scheduled", "the status changed to Scheduled")

    assignees = ok(staff.get("/api/staff/assignees")).json()
    vendor = next((a for a in assignees if a["kind"] == "outside_vendor"), None)
    check(vendor is not None, "the vendor list has an outside vendor")
    detail = ok(
        staff.patch(
            path,
            json={
                "updated_at": detail["updated_at"],
                "status": "waiting_on_vendor",
                "assignee_id": vendor["id"],
            },
        )
    ).json()
    check(detail["assignee_id"] == vendor["id"], f"assigned to {vendor['name']}")

    ok(
        staff.patch(
            path, json={"updated_at": detail["updated_at"], "status": "done", "needs_review": False}
        )
    )
    print(f"PASSED, and {reference} is now Done")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the API smoke test")
    parser.add_argument("api_url", help="for example https://api.example.com")
    run(parser.parse_args().api_url.rstrip("/"))
