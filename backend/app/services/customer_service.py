from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, func, cast, text
from geoalchemy2 import Geography
from typing import List, Optional
from collections import defaultdict

from app.models.customer import Customer
from app.models.meter import Meter
from app.models.officer import Officer
from app.schemas.customer import NearbyCustomerResponse, MeterSchema
from app.services.maps_service import haversine_distance

class CustomerService:

    @staticmethod
    async def get_nearby_customers(
        db: AsyncSession,
        latitude: float,
        longitude: float,
        radius_meters: float = 5000.0,
        status_filter: Optional[str] = None,
        officer_id: Optional[str] = None,
        limit: int = 15,
    ) -> List[NearbyCustomerResponse]:
        """
        Retrieves nearby pending customers within search radius using PostGIS 3.6 spatial distance.
        """
        ref_point_geo = func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326)
        
        # PostGIS distance expression: ST_Distance(Customer.location::geography, ref_point::geography)
        # Note: if Customer.location is null, fallback to ST_MakePoint(Customer.longitude, Customer.latitude)
        geom_col = func.coalesce(
            Customer.location,
            func.ST_SetSRID(func.ST_MakePoint(Customer.longitude, Customer.latitude), 4326)
        )
        dist_expr = func.ST_Distance(
            cast(geom_col, Geography),
            cast(ref_point_geo, Geography)
        ).label("distance_meters")

        stmt = select(Customer, dist_expr)

        conditions = [
            Customer.latitude != 0.0,
            Customer.longitude != 0.0
        ]

        if status_filter:
            conditions.append(Customer.status == status_filter)
        else:
            conditions.append(Customer.status != "paid")

        if officer_id:
            if isinstance(officer_id, (list, set, tuple)):
                conditions.append(
                    or_(
                        Customer.assigned_officer_id.in_(list(officer_id)),
                        Customer.uploaded_by_officer_id.in_(list(officer_id))
                    )
                )
            else:
                conditions.append(
                    or_(
                        Customer.assigned_officer_id == officer_id,
                        Customer.uploaded_by_officer_id == officer_id
                    )
                )

        # Spatial filter ST_DWithin
        conditions.append(
            func.ST_DWithin(
                cast(geom_col, Geography),
                cast(ref_point_geo, Geography),
                radius_meters
            )
        )

        stmt = stmt.where(and_(*conditions)).order_by(dist_expr).limit(limit)

        try:
            results = (await db.execute(stmt)).all()
        except Exception:
            # Fallback in case PostGIS extension not active yet or local connection: calculate via haversine
            officer_cond = text("1=1")
            if officer_id:
                if isinstance(officer_id, (list, set, tuple)):
                    officer_cond = or_(Customer.assigned_officer_id.in_(list(officer_id)), Customer.uploaded_by_officer_id.in_(list(officer_id)))
                else:
                    officer_cond = or_(Customer.assigned_officer_id == officer_id, Customer.uploaded_by_officer_id == officer_id)

            fallback_stmt = select(Customer).where(
                and_(
                    Customer.latitude != 0.0,
                    Customer.longitude != 0.0,
                    Customer.status == status_filter if status_filter else Customer.status != "paid",
                    officer_cond
                )
            ).limit(200)
            rows = (await db.execute(fallback_stmt)).scalars().all()
            with_dist = []
            for c in rows:
                d = haversine_distance(latitude, longitude, c.latitude, c.longitude)
                if d <= radius_meters:
                    with_dist.append((c, d))
            with_dist.sort(key=lambda x: x[1])
            results = with_dist[:limit]

        if not results:
            return []

        top_customer_ids = [c.customer_id for c, _ in results if c.customer_id]

        # Batch fetch meters for top candidate customers
        meters_stmt = select(Meter).where(Meter.customer_id.in_(top_customer_ids))
        meters_res = (await db.execute(meters_stmt)).scalars().all()

        meters_by_customer = defaultdict(list)
        for m in meters_res:
            meters_by_customer[m.customer_id].append(
                MeterSchema(
                    meter_id=m.meter_id,
                    meter_number=m.meter_number,
                    customer_id=m.customer_id,
                    latitude=float(m.latitude or 0.0),
                    longitude=float(m.longitude or 0.0),
                    assigned_officer_id=m.assigned_officer_id,
                    assigned_officer_name=m.assigned_officer_name,
                    uploaded_by_officer_id=m.uploaded_by_officer_id
                )
            )

        nearby_list = []
        for cus, dist in results:
            dist_val = float(dist)
            dur_mins = round((dist_val * 1.35 / 6.94) / 60.0, 1)

            nearby_item = NearbyCustomerResponse(
                id=str(cus.id),
                customer_id=cus.customer_id,
                name=cus.name,
                meter_number=cus.meter_number,
                phone=cus.phone or "",
                email=cus.email,
                address=cus.address or "",
                area=cus.area or "",
                latitude=float(cus.latitude),
                longitude=float(cus.longitude),
                dtc_code=cus.dtc_code,
                disconnection_status=cus.disconnection_status,
                pending_amount=float(cus.pending_amount or 0.0),
                due_date=cus.due_date,
                pending_days=cus.pending_days,
                status=cus.status or "pending",
                priority=cus.priority or "normal",
                assigned_officer_id=cus.assigned_officer_id,
                assigned_officer_name=cus.assigned_officer_name,
                uploaded_by_officer_id=cus.uploaded_by_officer_id,
                meters=meters_by_customer.get(cus.customer_id, []),
                created_at=str(cus.created_at or ""),
                updated_at=str(cus.updated_at or ""),
                distance_meters=round(dist_val, 1),
                estimated_duration_mins=max(1.0, dur_mins)
            )
            nearby_list.append(nearby_item)

        return nearby_list
