from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from datetime import datetime, timezone

from app.database import get_db, point_wkt
from app.models.user import User
from app.models.officer import Officer
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.utils.security import (
    verify_password_async,
    get_password_hash_async,
    create_access_token
)
from app.utils.dependencies import get_current_user

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_field_officer(
    request: RegisterRequest,
    db: AsyncSession = Depends(get_db)
):
    clean_email = request.email.lower().strip()

    # 1. Check if email already registered
    res = await db.execute(select(User).where(User.email == clean_email))
    existing_user = res.scalar_one_or_none()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address already exists."
        )

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # 2. Create User Account
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
    await db.flush()  # Populates user.id

    # 3. Create Field Officer Profile
    res = await db.execute(select(Officer.officer_id))
    all_officer_ids = res.scalars().all()
    max_num = 1000
    for off_id in all_officer_ids:
        if off_id and off_id.startswith("OFF-"):
            try:
                num = int(off_id.split("-")[1])
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
        target_collections_count=15,
        target_collection_amount=30000.0,
        current_latitude=default_lat,
        current_longitude=default_lng,
        current_location=point_wkt(default_lng, default_lat),
        is_active=True,
        created_at=now_str
    )
    db.add(officer)
    await db.commit()
    await db.refresh(user)

    # 4. Generate JWT Token
    access_token = create_access_token(
        data={"sub": clean_email, "role": "field_officer", "user_id": user.id}
    )

    user_resp = UserResponse(
        id=user.id,
        email=clean_email,
        full_name=request.full_name,
        role="field_officer",
        phone=request.phone,
        officer_id=officer_id,
        is_active=True
    )

    return TokenResponse(access_token=access_token, user=user_resp)

@router.post("/login", response_model=TokenResponse)
async def login(
    request: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    clean_email = request.email.lower().strip()
    res = await db.execute(select(User).where(User.email == clean_email))
    user = res.scalar_one_or_none()

    demo_defaults = {
        "officer@electricity.gov.in": ("OFF-1001", "Field Officer 1"),
        "officer1@electricity.gov.in": ("OFF-1002", "Field Officer 2"),
        "officer@mahavitaran.in": ("OFF-1003", "Field Officer 3"),
        "officer.nagpur@maharashtra.gov.in": ("OFF-1004", "Nagpur Field Officer"),
    }

    # Auto-seed default officer account for demo emails
    if not user and clean_email in demo_defaults:
        preferred_off_id, def_name = demo_defaults[clean_email]
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        pwd_hash = await get_password_hash_async(request.password if request.password else "officer123")
        user = User(
            email=clean_email,
            password_hash=pwd_hash,
            full_name=def_name,
            role="field_officer",
            phone="+91 98220 00000",
            is_active=True,
            created_at=now_str
        )
        db.add(user)
        await db.flush()

        # Check if preferred_off_id is already taken
        res_taken = await db.execute(select(Officer).where(Officer.officer_id == preferred_off_id))
        if res_taken.scalar_one_or_none():
            res_all = await db.execute(select(Officer.officer_id))
            all_ids = res_all.scalars().all()
            max_num = 1000
            for oid in all_ids:
                if oid and oid.startswith("OFF-"):
                    try:
                        num = int(oid.split("-")[1])
                        if num > max_num:
                            max_num = num
                    except (IndexError, ValueError):
                        pass
            assigned_off_id = f"OFF-{max_num + 1}"
        else:
            assigned_off_id = preferred_off_id

        officer = Officer(
            officer_id=assigned_off_id,
            user_id=user.id,
            full_name=def_name,
            email=clean_email,
            phone="+91 98220 00000",
            assigned_area="Central Ward",
            target_collections_count=15,
            target_collection_amount=30000.0,
            current_latitude=21.1458,
            current_longitude=79.0882,
            current_location=point_wkt(79.0882, 21.1458),
            is_active=True,
            created_at=now_str
        )
        db.add(officer)
        await db.commit()
        await db.refresh(user)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    is_valid_pwd = await verify_password_async(request.password, user.password_hash)
    if not is_valid_pwd:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled"
        )

    # Fetch or ensure unique officer_id for field officer
    officer_id = None
    if user.role == "field_officer":
        off_res = await db.execute(select(Officer).where(or_(Officer.user_id == user.id, Officer.email == clean_email)))
        officer = off_res.scalar_one_or_none()
        if not officer:
            res_all = await db.execute(select(Officer.officer_id))
            all_ids = res_all.scalars().all()
            max_num = 1000
            for oid in all_ids:
                if oid and oid.startswith("OFF-"):
                    try:
                        num = int(oid.split("-")[1])
                        if num > max_num:
                            max_num = num
                    except (IndexError, ValueError):
                        pass
            officer = Officer(
                officer_id=f"OFF-{max_num + 1}",
                user_id=user.id,
                full_name=user.full_name,
                email=clean_email,
                phone=user.phone or "",
                assigned_area="Central Ward",
                target_collections_count=15,
                target_collection_amount=30000.0,
                current_latitude=21.1458,
                current_longitude=79.0882,
                current_location=point_wkt(79.0882, 21.1458),
                is_active=True,
                created_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
            )
            db.add(officer)
            await db.commit()
            await db.refresh(officer)
        officer_id = officer.officer_id

    access_token = create_access_token(
        data={"sub": user.email, "role": user.role, "user_id": user.id}
    )

    user_resp = UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        phone=user.phone,
        officer_id=officer_id,
        is_active=user.is_active
    )

    return TokenResponse(access_token=access_token, user=user_resp)

@router.post("/logout")
async def logout(current_user: dict = Depends(get_current_user)):
    return {"message": "Successfully logged out"}

@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    officer_id = None
    if current_user.get("role") == "field_officer":
        off_res = await db.execute(select(Officer).where(Officer.user_id == current_user["_id"]))
        officer = off_res.scalar_one_or_none()
        if officer:
            officer_id = officer.officer_id

    return UserResponse(
        id=current_user["_id"],
        email=current_user["email"],
        full_name=current_user.get("full_name", ""),
        role=current_user.get("role", "field_officer"),
        phone=current_user.get("phone"),
        officer_id=officer_id,
        is_active=current_user.get("is_active", True)
    )
