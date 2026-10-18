from sqlalchemy import Column, String, Text, JSON
from uuid import uuid4
from datetime import datetime, timezone
from app.models.base import Base

def gen_uuid() -> str:
    return str(uuid4())

def utc_now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

class Assignment(Base):
    __tablename__ = "assignments"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    officer_id = Column(String(50), index=True, nullable=False)
    target_ids = Column(JSON, nullable=False)  # List of customer_ids or meter_ids
    type = Column(String(50), default="customer", nullable=False)
    assigned_by = Column(String(64), nullable=False)
    created_at = Column(String(64), default=utc_now_str, nullable=False)

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    action = Column(String(100), index=True, nullable=False)
    user_id = Column(String(64), index=True, nullable=True)
    officer_id = Column(String(50), index=True, nullable=True)
    details = Column(JSON, nullable=True)
    timestamp = Column(String(64), default=utc_now_str, index=True, nullable=False)

class FieldVisit(Base):
    __tablename__ = "field_visits"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    customer_id = Column(String(100), index=True, nullable=False)
    officer_id = Column(String(50), index=True, nullable=False)
    date_time = Column(String(64), default=utc_now_str, index=True, nullable=False)
    notes = Column(Text, nullable=True)
    result = Column(String(100), nullable=True)
