from sqlalchemy import Column, String, Boolean, Integer, Float
from geoalchemy2 import Geometry
from uuid import uuid4
from datetime import datetime, timezone
from app.models.base import Base

def gen_uuid() -> str:
    return str(uuid4())

def utc_now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

class Officer(Base):
    __tablename__ = "officers"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    officer_id = Column(String(50), unique=True, index=True, nullable=False)
    user_id = Column(String(64), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    email = Column(String(255), index=True, nullable=False)
    phone = Column(String(50), nullable=True)
    assigned_area = Column(String(255), default="Central Ward", nullable=False)
    target_collections_count = Column(Integer, default=15, nullable=False)
    target_collection_amount = Column(Float, default=25000.0, nullable=False)
    
    # PostGIS 3.6 Spatial Point Geometry
    current_location = Column(Geometry(geometry_type="POINT", srid=4326, spatial_index=True), nullable=True)
    current_latitude = Column(Float, nullable=True)
    current_longitude = Column(Float, nullable=True)
    
    last_active = Column(String(64), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(String(64), default=utc_now_str, nullable=False)
    updated_at = Column(String(64), nullable=True)
