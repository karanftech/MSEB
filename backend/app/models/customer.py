from sqlalchemy import Column, String, Float, Index
from geoalchemy2 import Geometry
from uuid import uuid4
from datetime import datetime, timezone
from app.models.base import Base

def gen_uuid() -> str:
    return str(uuid4())

def utc_now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

class Customer(Base):
    __tablename__ = "customers"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    customer_id = Column(String(100), unique=True, index=True, nullable=False)
    name = Column(String(255), index=True, default="Consumer", nullable=False)
    meter_number = Column(String(100), index=True, default="", nullable=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    address = Column(String(500), default="", nullable=True)
    area = Column(String(100), index=True, default="Nagpur", nullable=True)
    
    latitude = Column(Float, default=21.1458, nullable=False)
    longitude = Column(Float, default=79.0882, nullable=False)
    
    # PostGIS 3.6 Spatial Point: geometry(Point, 4326)
    location = Column(Geometry(geometry_type="POINT", srid=4326, spatial_index=True), nullable=True)

    dtc_code = Column(String(255), index=True, default="0101001", nullable=True)
    disconnection_status = Column(String(100), index=True, nullable=True)
    pending_amount = Column(Float, default=0.0, index=True, nullable=False)
    due_date = Column(String(100), nullable=True)
    pending_days = Column(String(100), nullable=True)
    status = Column(String(50), default="pending", index=True, nullable=False)
    priority = Column(String(50), default="normal", index=True, nullable=False)
    
    assigned_officer_id = Column(String(50), index=True, nullable=True)
    assigned_officer_name = Column(String(255), nullable=True)
    uploaded_by_officer_id = Column(String(50), index=True, nullable=True)

    created_at = Column(String(64), default=utc_now_str, nullable=False)
    updated_at = Column(String(64), nullable=True)

# Composite indexes for high-throughput queries
Index("idx_customers_assigned_status", Customer.assigned_officer_id, Customer.status)
Index("idx_customers_uploaded_status", Customer.uploaded_by_officer_id, Customer.status)
Index("idx_customers_assigned_dtc", Customer.assigned_officer_id, Customer.dtc_code)
Index("idx_customers_uploaded_dtc", Customer.uploaded_by_officer_id, Customer.dtc_code)
