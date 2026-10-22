from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime

class MeterSchema(BaseModel):
    meter_id: str
    meter_number: str
    customer_id: str
    latitude: float
    longitude: float
    dtc_code: Optional[str] = None
    assigned_officer_id: Optional[str] = None
    assigned_officer_name: Optional[str] = None
    uploaded_by_officer_id: Optional[str] = None


class CustomerCreate(BaseModel):
    customer_id: str
    name: str
    phone: str
    email: Optional[str] = None
    address: str
    area: str
    latitude: float
    longitude: float
    meter_number: str
    dtc_code: Optional[str] = None
    pending_amount: Optional[float] = 0.0
    due_date: Optional[str] = None
    pending_days: Optional[Any] = None
    status: Optional[str] = "pending"
    priority: Optional[str] = "normal"
    disconnection_status: Optional[str] = None
    assigned_officer_id: Optional[str] = None
    uploaded_by_officer_id: Optional[str] = None

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    area: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    dtc_code: Optional[str] = None
    disconnection_status: Optional[str] = None
    pending_days: Optional[Any] = None
    assigned_officer_id: Optional[str] = None
    status: Optional[str] = None

class CustomerResponse(BaseModel):
    id: str
    customer_id: str
    name: str
    meter_number: str
    phone: str
    email: Optional[str] = None
    address: str
    area: str
    latitude: float
    longitude: float
    dtc_code: Optional[str] = None
    disconnection_status: Optional[str] = None
    pending_amount: float = 0.0
    collected_amount: float = 0.0
    due_date: Optional[str] = None
    pending_days: Optional[Any] = None
    status: str = "pending"  # pending, overdue, paid, partially_paid
    priority: str = "normal"  # normal, high, critical
    assigned_officer_id: Optional[str] = None
    assigned_officer_name: Optional[str] = None
    uploaded_by_officer_id: Optional[str] = None
    meters: List[MeterSchema] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class NearbyCustomerResponse(CustomerResponse):
    distance_meters: float
    estimated_duration_mins: float

class DTCCodeOption(BaseModel):
    code: str
    meter_count: int

class DTCCodesResponse(BaseModel):
    total_dtcs: int
    total_meters: int
    dtcs: List[DTCCodeOption]


