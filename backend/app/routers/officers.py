from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from typing import List
from datetime import datetime, timezone

from app.database import get_db, point_wkt
from app.models.officer import Officer
from app.models.user import User
from app.models.customer import Customer
from app.models.payment import Payment
from app.schemas.officer import OfficerCreate, OfficerUpdate, OfficerResponse
from app.utils.security import get_password_hash_async
from app.utils.dependencies import get_current_user

router = APIRouter(prefix="/api/officers", tags=["Field Officers"])

@router.get("", response_model=List[OfficerResponse])
async def list_officers(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    stmt = select(Officer)
    officers = (await db.execute(stmt)).scalars().all()

    results = []
    for off in officers:
        # Assigned customer count
        cus_stmt = select(func.count(Customer.id)).where(Customer.assigned_officer_id == off.officer_id)
        cus_count = (await db.execute(cus_stmt)).scalar() or 0

        # Total collections
        pmt_stmt = select(func.coalesce(func.sum(Payment.amount), 0.0)).where(Payment.officer_id == off.officer_id)
        total_collected = float((await db.execute(pmt_stmt)).scalar() or 0.0)

        results.append(
            OfficerResponse(
                id=str(off.id),
                officer_id=off.officer_id,
                user_id=str(off.user_id),
                full_name=off.full_name,
                email=off.email,
                phone=off.phone or "",
                assigned_area=off.assigned_area or "Central Ward",
                assigned_customers_count=cus_count,
                total_collected_amount=total_collected,
                target_collections_count=off.target_collections_count or 15,
                target_collection_amount=float(off.target_collection_amount or 25000.0),
                current_latitude=off.current_latitude,
                current_longitude=off.current_longitude,
                last_active=off.last_active,
                is_active=off.is_active
            )
        )
    return results

@router.post("", response_model=OfficerResponse)
async def create_officer(
    request: OfficerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    clean_email = request.email.lower().strip()
    u_stmt = select(User).where(User.email == clean_email)
    existing_user = (await db.execute(u_stmt)).scalar_one_or_none()
    if existing_user:
        raise HTTPException(status_code=400, detail="User with this email already exists.")

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # 1. Create User
    pwd_hash = await get_password_hash_async(request.password)
    user = User(
        email=clean_email,
        password_hash=pwd_hash,
        full_name=request.full_name,
        role="field_officer",
        phone=request.phone or "",
        is_active=True,
        created_at=now_str
    )
    db.add(user)
    await db.flush()

    # 2. Generate Officer ID
    all_offs = (await db.execute(select(Officer.officer_id))).scalars().all()
    max_num = 1000
    for o_id in all_offs:
        if o_id and o_id.startswith("OFF-"):
            try:
                num = int(o_id.split("-")[1])
                if num > max_num:
                    max_num = num
            except (IndexError, ValueError):
                pass

    officer_id = f"OFF-{max_num + 1}"

    default_lat = 21.1458
    default_lng = 79.0882
    officer = Officer(
        officer_id=officer_id,
        user_id=user.id,
        full_name=request.full_name,
        email=clean_email,
        phone=request.phone or "",
        assigned_area=request.assigned_area or "Central Ward",
        target_collections_count=request.target_collections_count,
        target_collection_amount=request.target_collection_amount,
        current_latitude=default_lat,
        current_longitude=default_lng,
        current_location=point_wkt(default_lng, default_lat),
        is_active=True,
        created_at=now_str
    )
    db.add(officer)
    await db.commit()
    await db.refresh(officer)

    return OfficerResponse(
        id=str(officer.id),
        officer_id=officer.officer_id,
        user_id=str(officer.user_id),
        full_name=officer.full_name,
        email=officer.email,
        phone=officer.phone or "",
        assigned_area=officer.assigned_area,
        assigned_customers_count=0,
        total_collected_amount=0.0,
        target_collections_count=officer.target_collections_count,
        target_collection_amount=officer.target_collection_amount,
        current_latitude=officer.current_latitude,
        current_longitude=officer.current_longitude,
        last_active=officer.last_active,
        is_active=officer.is_active
    )

@router.put("/{officer_id}", response_model=OfficerResponse)
async def update_officer(
    officer_id: str,
    request: OfficerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    stmt = select(Officer).where(Officer.officer_id == officer_id)
    officer = (await db.execute(stmt)).scalar_one_or_none()
    if not officer:
        raise HTTPException(status_code=404, detail="Officer not found")

    if request.full_name is not None:
        officer.full_name = request.full_name
    if request.phone is not None:
        officer.phone = request.phone
    if request.assigned_area is not None:
        officer.assigned_area = request.assigned_area
    if request.target_collections_count is not None:
        officer.target_collections_count = request.target_collections_count
    if request.target_collection_amount is not None:
        officer.target_collection_amount = request.target_collection_amount
    if request.is_active is not None:
        officer.is_active = request.is_active

    officer.updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    await db.commit()
    await db.refresh(officer)

    # Assigned customer count
    cus_count = (await db.execute(select(func.count(Customer.id)).where(Customer.assigned_officer_id == officer.officer_id))).scalar() or 0
    total_collected = float((await db.execute(select(func.coalesce(func.sum(Payment.amount), 0.0)).where(Payment.officer_id == officer.officer_id))).scalar() or 0.0)

    return OfficerResponse(
        id=str(officer.id),
        officer_id=officer.officer_id,
        user_id=str(officer.user_id),
        full_name=officer.full_name,
        email=officer.email,
        phone=officer.phone or "",
        assigned_area=officer.assigned_area,
        assigned_customers_count=cus_count,
        total_collected_amount=total_collected,
        target_collections_count=officer.target_collections_count,
        target_collection_amount=officer.target_collection_amount,
        current_latitude=officer.current_latitude,
        current_longitude=officer.current_longitude,
        last_active=officer.last_active,
        is_active=officer.is_active
    )
