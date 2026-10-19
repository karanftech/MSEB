from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from typing import Dict, Any, Set
from datetime import datetime, timezone

from app.database import get_db, point_wkt
from app.models.user import User
from app.models.officer import Officer
from app.utils.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception
        
    user_email: str = payload.get("sub")
    if user_email is None:
        raise credentials_exception

    clean_email = user_email.lower().strip()
    result = await db.execute(select(User).where(User.email == clean_email))
    user = result.scalar_one_or_none()
    if not user:
        result = await db.execute(select(User).where(User.email == user_email))
        user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise credentials_exception
        
    return {
        "_id": user.id,
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "phone": user.phone,
        "is_active": user.is_active
    }

async def get_or_create_officer_context(
    db: AsyncSession,
    current_user: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Guarantees that an officer context with a unique officer_id and filter_ids is resolved
    for the authenticated user.
    """
    user_id_str = str(current_user["_id"])
    clean_email = current_user.get("email", "").lower().strip()

    res = await db.execute(
        select(Officer).where(
            or_(
                Officer.user_id == user_id_str,
                Officer.email == clean_email
            )
        )
    )
    officer_doc = res.scalar_one_or_none()

    if not officer_doc:
        # Generate next unique officer_id (OFF-XXXX)
        res_all = await db.execute(select(Officer.officer_id))
        all_ids = res_all.scalars().all()
        max_num = 1000
        for off_id in all_ids:
            if off_id and off_id.startswith("OFF-"):
                try:
                    num = int(off_id.split("-")[1])
                    if num > max_num:
                        max_num = num
                except (IndexError, ValueError):
                    pass

        new_officer_id = f"OFF-{max_num + 1}"
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        default_lat = 21.1458
        default_lng = 79.0882

        officer_doc = Officer(
            officer_id=new_officer_id,
            user_id=user_id_str,
            full_name=current_user.get("full_name") or "Field Officer",
            email=clean_email,
            phone=current_user.get("phone") or "",
            assigned_area="Central Ward",
            target_collections_count=15,
            target_collection_amount=30000.0,
            current_latitude=default_lat,
            current_longitude=default_lng,
            current_location=point_wkt(default_lng, default_lat),
            is_active=True,
            created_at=now_str
        )
        db.add(officer_doc)
        try:
            await db.commit()
            await db.refresh(officer_doc)
        except Exception:
            await db.rollback()
            res_retry = await db.execute(
                select(Officer).where(
                    or_(
                        Officer.user_id == user_id_str,
                        Officer.email == clean_email
                    )
                )
            )
            officer_doc = res_retry.scalar_one_or_none()

    officer_id = officer_doc.officer_id if officer_doc else f"OFF-{user_id_str[:8]}"
    officer_name = (officer_doc.full_name if officer_doc else None) or current_user.get("full_name") or "Field Officer"

    filter_ids = {officer_id, user_id_str}
    if officer_doc and officer_doc.user_id:
        filter_ids.add(str(officer_doc.user_id))

    return {
        "officer_id": officer_id,
        "officer_name": officer_name,
        "user_id": user_id_str,
        "filter_ids": filter_ids,
        "officer_doc": officer_doc
    }

async def require_officer(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if current_user.get("role") != "field_officer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation permitted only for Field Officers"
        )
    return current_user

