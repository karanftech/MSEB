from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from datetime import datetime, timezone

from app.database import get_db
from app.models.officer import Officer
from app.models.customer import Customer
from app.models.meter import Meter
from app.models.audit import Assignment
from app.schemas.officer import CustomerAssignmentRequest, MeterAssignmentRequest
from app.utils.dependencies import get_current_user

router = APIRouter(prefix="/api/assignments", tags=["Assignments"])

@router.post("")
async def assign_customers(
    request: CustomerAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    stmt = select(Officer).where(Officer.officer_id == request.officer_id)
    officer = (await db.execute(stmt)).scalar_one_or_none()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found")

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # Update assigned officer on Customers
    cus_upd = (
        update(Customer)
        .where(Customer.customer_id.in_(request.customer_ids))
        .values(
            assigned_officer_id=request.officer_id,
            assigned_officer_name=officer.full_name,
            updated_at=now_str
        )
    )
    res = await db.execute(cus_upd)
    modified_count = res.rowcount or 0

    # Sync assigned officer on associated Meters
    mtr_upd = (
        update(Meter)
        .where(Meter.customer_id.in_(request.customer_ids))
        .values(
            assigned_officer_id=request.officer_id,
            assigned_officer_name=officer.full_name,
            updated_at=now_str
        )
    )
    await db.execute(mtr_upd)

    # Record assignment event
    assignment = Assignment(
        officer_id=request.officer_id,
        target_ids=request.customer_ids,
        type="customer",
        assigned_by=str(current_user["_id"]),
        created_at=now_str
    )
    db.add(assignment)
    await db.commit()

    return {
        "message": f"Successfully assigned {modified_count} customers (and associated meters) to officer '{officer.full_name}'",
        "officer_id": request.officer_id,
        "count": modified_count
    }

@router.post("/meters")
async def assign_meters(
    request: MeterAssignmentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    stmt = select(Officer).where(Officer.officer_id == request.officer_id)
    officer = (await db.execute(stmt)).scalar_one_or_none()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found")

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # Update assigned officer on Meters
    mtr_upd = (
        update(Meter)
        .where(
            (Meter.meter_id.in_(request.meter_ids)) | (Meter.meter_number.in_(request.meter_ids))
        )
        .values(
            assigned_officer_id=request.officer_id,
            assigned_officer_name=officer.full_name,
            updated_at=now_str
        )
    )
    res = await db.execute(mtr_upd)
    modified_count = res.rowcount or 0

    # Find affected customer IDs
    m_stmt = select(Meter.customer_id).where(
        (Meter.meter_id.in_(request.meter_ids)) | (Meter.meter_number.in_(request.meter_ids))
    )
    customer_ids = list(set((await db.execute(m_stmt)).scalars().all()))

    if customer_ids:
        cus_upd = (
            update(Customer)
            .where(Customer.customer_id.in_(customer_ids))
            .values(
                assigned_officer_id=request.officer_id,
                assigned_officer_name=officer.full_name,
                updated_at=now_str
            )
        )
        await db.execute(cus_upd)

    # Record assignment event
    assignment = Assignment(
        officer_id=request.officer_id,
        target_ids=request.meter_ids,
        type="meter",
        assigned_by=str(current_user["_id"]),
        created_at=now_str
    )
    db.add(assignment)
    await db.commit()

    return {
        "message": f"Successfully assigned {modified_count} meters to officer '{officer.full_name}'",
        "officer_id": request.officer_id,
        "count": modified_count
    }
