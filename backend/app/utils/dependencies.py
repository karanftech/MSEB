from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict, Any

from app.database import get_db
from app.models.user import User
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

async def require_officer(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if current_user.get("role") != "field_officer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operation permitted only for Field Officers"
        )
    return current_user
