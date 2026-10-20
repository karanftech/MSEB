from pydantic import BaseModel
from typing import List, Optional

class Coordinates(BaseModel):
    latitude: float
    longitude: float

class RouteCalculationRequest(BaseModel):
    origin: Coordinates
    destination: Coordinates
    customer_id: Optional[str] = None
    meter_id: Optional[str] = None

class RouteStep(BaseModel):
    instruction: str
    distance_text: str
    duration_text: str
    start_location: Coordinates
    end_location: Coordinates

class RouteCalculationResponse(BaseModel):
    distance_meters: float
    distance_text: str
    duration_seconds: float
    duration_text: str
    start_address: str
    end_address: str
    encoded_polyline: str
    coordinates_path: List[Coordinates]
    steps: List[RouteStep] = []

class MultiRouteCustomerInput(BaseModel):
    customer_id: str
    name: Optional[str] = "Consumer"
    meter_number: Optional[str] = ""
    latitude: float
    longitude: float
    pending_amount: Optional[float] = 0.0
    address: Optional[str] = ""
    priority: Optional[str] = "normal"

class MultiRouteCalculationRequest(BaseModel):
    origin: Coordinates
    customers: List[MultiRouteCustomerInput]

class MultiRouteStop(BaseModel):
    sequence: int
    customer_id: str
    name: Optional[str] = "Consumer"
    meter_number: Optional[str] = ""
    pending_amount: Optional[float] = 0.0
    address: Optional[str] = ""
    latitude: float
    longitude: float
    distance_from_prev_meters: float
    distance_from_prev_text: str
    duration_from_prev_text: str

class MultiRouteCalculationResponse(BaseModel):
    total_distance_meters: float
    total_distance_text: str
    total_duration_seconds: float
    total_duration_text: str
    coordinates_path: List[Coordinates]
    stops: List[MultiRouteStop]

