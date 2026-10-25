from sqlalchemy import Column, String, Float, Index, UniqueConstraint
from sqlalchemy.orm import Mapped
from geoalchemy2 import Geometry
from typing import Optional, Any
from uuid import uuid4
from datetime import datetime, timezone
from app.models.base import Base

def gen_uuid() -> str:
    return str(uuid4())

def utc_now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = Column(String(64), primary_key=True, default=gen_uuid)
    customer_id: Mapped[str] = Column(String(100), index=True, nullable=False)
    name: Mapped[str] = Column(String(255), index=True, default="Consumer", nullable=False)
    meter_number: Mapped[Optional[str]] = Column(String(100), index=True, default="", nullable=True)
    phone: Mapped[Optional[str]] = Column(String(50), nullable=True)
    email: Mapped[Optional[str]] = Column(String(255), nullable=True)
    address: Mapped[Optional[str]] = Column(String(500), default="", nullable=True)
    area: Mapped[Optional[str]] = Column(String(100), index=True, default="Nagpur", nullable=True)
    
    latitude: Mapped[float] = Column(Float, default=21.1458, nullable=False)
    longitude: Mapped[float] = Column(Float, default=79.0882, nullable=False)
    
    # PostGIS 3.6 Spatial Point: geometry(Point, 4326)
    location: Mapped[Optional[Any]] = Column(Geometry(geometry_type="POINT", srid=4326, spatial_index=True), nullable=True)

    dtc_code: Mapped[Optional[str]] = Column(String(255), index=True, default="0101001", nullable=True)
    disconnection_status: Mapped[Optional[str]] = Column(String(100), index=True, nullable=True)
    pending_amount: Mapped[float] = Column(Float, default=0.0, index=True, nullable=False)
    due_date: Mapped[Optional[str]] = Column(String(100), nullable=True)
    pending_days: Mapped[Optional[str]] = Column(String(100), nullable=True)
    status: Mapped[str] = Column(String(50), default="pending", index=True, nullable=False)
    priority: Mapped[str] = Column(String(50), default="normal", index=True, nullable=False)
    
    assigned_officer_id: Mapped[Optional[str]] = Column(String(50), index=True, nullable=True)
    assigned_officer_name: Mapped[Optional[str]] = Column(String(255), nullable=True)
    uploaded_by_officer_id: Mapped[Optional[str]] = Column(String(50), index=True, nullable=True)

    created_at: Mapped[str] = Column(String(64), default=utc_now_str, nullable=False)
    updated_at: Mapped[Optional[str]] = Column(String(64), nullable=True)

    __table_args__ = (
        UniqueConstraint("customer_id", "uploaded_by_officer_id", name="uq_customers_customer_officer"),
        Index("idx_customers_assigned_status", "assigned_officer_id", "status"),
        Index("idx_customers_uploaded_status", "uploaded_by_officer_id", "status"),
        Index("idx_customers_assigned_dtc", "assigned_officer_id", "dtc_code"),
        Index("idx_customers_uploaded_dtc", "uploaded_by_officer_id", "dtc_code"),
    )
