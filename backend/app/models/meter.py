from sqlalchemy import Column, String, Float, Index
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

class Meter(Base):
    __tablename__ = "meters"

    id: Mapped[str] = Column(String(64), primary_key=True, default=gen_uuid)
    meter_id: Mapped[str] = Column(String(255), index=True, nullable=False)
    meter_number: Mapped[str] = Column(String(255), index=True, nullable=False)  # indexed, but not unique to prevent collision on unmetered/shared entries
    customer_id: Mapped[str] = Column(String(100), index=True, nullable=False)
    
    latitude: Mapped[Optional[float]] = Column(Float, default=21.1458, nullable=True)
    longitude: Mapped[Optional[float]] = Column(Float, default=79.0882, nullable=True)
    
    # PostGIS 3.6 Spatial Point: geometry(Point, 4326)
    location: Mapped[Optional[Any]] = Column(Geometry(geometry_type="POINT", srid=4326, spatial_index=True), nullable=True)

    dtc_code: Mapped[Optional[str]] = Column(String(255), index=True, nullable=True)
    assigned_officer_id: Mapped[Optional[str]] = Column(String(50), index=True, nullable=True)
    assigned_officer_name: Mapped[Optional[str]] = Column(String(255), nullable=True)
    uploaded_by_officer_id: Mapped[Optional[str]] = Column(String(50), index=True, nullable=True)

    created_at: Mapped[str] = Column(String(64), default=utc_now_str, nullable=False)
    updated_at: Mapped[Optional[str]] = Column(String(64), nullable=True)

Index("idx_meters_assigned_officer", Meter.assigned_officer_id)
Index("idx_meters_uploaded_officer", Meter.uploaded_by_officer_id)
Index("idx_meters_dtc", Meter.dtc_code)
Index("idx_meters_customer", Meter.customer_id)
