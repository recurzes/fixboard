"""Status and assignment rules, as pure functions so every case can be tested in a table."""

from app.assignees.models import AssigneeKind
from app.requests.models import RequestStatus


def can_transition(current: RequestStatus, target: RequestStatus) -> bool:
    # Any to any, including reopening Done, so a mistake can always be undone.
    return True


def resolve_status(
    current: RequestStatus, requested: RequestStatus | None, assignee_kind: AssigneeKind | None
) -> RequestStatus:
    """The status a change ends on, judged on the final assignee. ValueError if not allowed.

    `requested` is None when the change does not name a status. Goes by kind, not name, because
    entries can be renamed.
    """
    has_vendor = assignee_kind == AssigneeKind.outside_vendor
    if requested is None:
        if current == RequestStatus.waiting_on_vendor and not has_vendor:
            return RequestStatus.scheduled
        return current
    if not can_transition(current, requested):
        raise ValueError(f"Cannot move from {current} to {requested}")
    if requested == RequestStatus.waiting_on_vendor and not has_vendor:
        raise ValueError("Waiting on vendor needs an outside vendor as the assignee")
    return requested
