from sqlalchemy import Column, String, Boolean, DateTime
from datetime import datetime, timezone
from uuid import uuid4
from app.models.base import Base

def gen_uuid() -> str:
    return str(uuid4())

def utc_now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

class User(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(String(50), default="field_officer", index=True, nullable=False)
    phone = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(String(64), default=utc_now_str, nullable=False)
    updated_at = Column(String(64), nullable=True)
