from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from app.staff.auth import CurrentStaff, require_staff

# On the router, so a staff endpoint added later cannot forget the guard.
router = APIRouter(prefix="/api/staff", dependencies=[Depends(require_staff)])


class StaffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    email: str


@router.get("/me", response_model=StaffOut)
def get_me(staff: CurrentStaff):
    return staff
