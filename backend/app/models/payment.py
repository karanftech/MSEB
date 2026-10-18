from sqlalchemy import Column, String, Float, Index
from geoalchemy2 import Geometry
from uuid import uuid4
from datetime import datetime, timezone
from app.models.base import Base

def gen_uuid() -> str:
    return str(uuid4())

def utc_now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

class Payment(Base):
    __tablename__ = "payments"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    payment_id = Column(String(100), unique=True, index=True, nullable=False)
    receipt_number = Column(String(100), unique=True, index=True, nullable=False)
    bill_id = Column(String(100), nullable=True)
    customer_id = Column(String(100), index=True, nullable=False)
    customer_name = Column(String(255), nullable=True)
    meter_id = Column(String(100), nullable=True)
    meter_number = Column(String(100), nullable=True)
    officer_id = Column(String(50), index=True, nullable=False)
    officer_name = Column(String(255), nullable=True)
    amount = Column(Float, nullable=False)
    payment_method = Column(String(50), nullable=False)
    disconnection_status = Column(String(50), nullable=True)
    transaction_reference = Column(String(255), nullable=True)
    remarks = Column(String(500), nullable=True)
    
    collection_latitude = Column(Float, nullable=True)
    collection_longitude = Column(Float, nullable=True)
    collection_location = Column(Geometry(geometry_type="POINT", srid=4326, spatial_index=True), nullable=True)

    previous_pending_amount = Column(Float, default=0.0, nullable=False)
    remaining_pending_amount = Column(Float, default=0.0, nullable=False)
    bill_status = Column(String(50), default="paid", nullable=False)
    created_at = Column(String(64), default=utc_now_str, index=True, nullable=False)

Index("idx_payments_officer_created", Payment.officer_id, Payment.created_at)
Index("idx_payments_customer_created", Payment.customer_id, Payment.created_at)
