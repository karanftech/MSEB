from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, func, desc
from datetime import datetime, timezone
from typing import Optional, Any
import logging

from app.database import get_db
from app.models.customer import Customer
from app.models.officer import Officer
from app.models.payment import Payment
from app.schemas.dashboard import OfficerDashboardMetrics
from app.services.customer_service import CustomerService
from app.services.cache_service import cache_service
from app.utils.dependencies import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

def safe_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

@router.get("/officer", response_model=OfficerDashboardMetrics)
async def get_officer_dashboard(
    latitude: Optional[float] = Query(21.1458),
    longitude: Optional[float] = Query(79.0882),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    try:
        user_id_str = str(current_user["_id"])
        lat_rounded = round(latitude or 21.1458, 3)
        lng_rounded = round(longitude or 79.0882, 3)
        cache_key = f"dashboard:officer:{user_id_str}:{lat_rounded}:{lng_rounded}"

        cached_metrics = await cache_service.get(cache_key)
        if cached_metrics:
            return OfficerDashboardMetrics(**cached_metrics)

        today_date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # 1. Fetch officer record
        res = await db.execute(select(Officer).where(
            or_(
                Officer.user_id == current_user["_id"],
                Officer.email == current_user.get("email")
            )
        ))
        officer_doc = res.scalar_one_or_none()
        officer_id = officer_doc.officer_id if officer_doc else None

        # Build customer filter for officer
        officer_cus_conds = []
        if officer_id:
            officer_cus_conds.append(
                or_(
                    Customer.assigned_officer_id == officer_id,
                    Customer.uploaded_by_officer_id == officer_id
                )
            )

        # Total assigned customers
        tot_stmt = select(func.count(Customer.id))
        if officer_cus_conds:
            tot_stmt = tot_stmt.where(and_(*officer_cus_conds))
        total_assigned = (await db.execute(tot_stmt)).scalar() or 0

        # Pending customers count & total pending amount
        pending_conds = [Customer.status.in_(["pending", "overdue", "partially_paid"])]
        if officer_cus_conds:
            pending_conds.extend(officer_cus_conds)
        pending_stmt = select(
            func.count(Customer.id),
            func.coalesce(func.sum(Customer.pending_amount), 0.0)
        ).where(and_(*pending_conds))
        pend_row = (await db.execute(pending_stmt)).first()
        pending_count = pend_row[0] if pend_row else 0
        total_pending_amount = float(pend_row[1]) if pend_row else 0.0

        # Paid count
        paid_conds = [Customer.status == "paid"]
        if officer_cus_conds:
            paid_conds.extend(officer_cus_conds)
        paid_stmt = select(func.count(Customer.id)).where(and_(*paid_conds))
        paid_count = (await db.execute(paid_stmt)).scalar() or 0

        # Today's collected amount & count
        pmt_conds = [Payment.created_at.like(f"{today_date_str}%")]
        if officer_id:
            pmt_conds.append(Payment.officer_id == officer_id)
        pmt_stmt = select(
            func.count(Payment.id),
            func.coalesce(func.sum(Payment.amount), 0.0)
        ).where(and_(*pmt_conds))
        pmt_row = (await db.execute(pmt_stmt)).first()
        today_collections_count = pmt_row[0] if pmt_row else 0
        today_collected_amount = float(pmt_row[1]) if pmt_row else 0.0

        # Targets
        target_amount = float(officer_doc.target_collection_amount) if officer_doc else 30000.0
        remaining_collections_count = max(0, pending_count)
        remaining_collections_amount = max(0.0, total_pending_amount)

        # Categorized disconnection statuses
        categories = {"TD": [0, 0.0], "PD": [0, 0.0], "BUR": [0, 0.0], "DIS": [0, 0.0], "OTHER": [0, 0.0]}
        for cat in categories.keys():
            cat_conds = [
                or_(
                    Customer.disconnection_status.ilike(cat),
                    Customer.status.ilike(cat)
                )
            ]
            if officer_cus_conds:
                cat_conds.extend(officer_cus_conds)
            cat_stmt = select(
                func.count(Customer.id),
                func.coalesce(func.sum(Customer.pending_amount), 0.0)
            ).where(and_(*cat_conds))
            cat_row = (await db.execute(cat_stmt)).first()
            if cat_row:
                categories[cat] = [cat_row[0], float(cat_row[1])]

        # Fetch nearby pending customers via PostGIS
        nearby = await CustomerService.get_nearby_customers(
            db=db,
            latitude=latitude or 21.1458,
            longitude=longitude or 79.0882,
            radius_meters=5000.0,
            status_filter=None,
            officer_id=officer_id,
            limit=10
        )

        metrics = OfficerDashboardMetrics(
            total_assigned_customers=total_assigned,
            total_pending_amount=round(total_pending_amount, 2),
            number_of_pending_bills=pending_count,
            number_of_completed_collections=paid_count,
            todays_collection_target=target_amount,
            todays_collected_amount=round(today_collected_amount, 2),
            remaining_collections_count=remaining_collections_count,
            remaining_collections_amount=round(remaining_collections_amount, 2),
            td_customers_count=categories["TD"][0],
            td_pending_amount=round(categories["TD"][1], 2),
            pd_customers_count=categories["PD"][0],
            pd_pending_amount=round(categories["PD"][1], 2),
            bur_customers_count=categories["BUR"][0],
            bur_pending_amount=round(categories["BUR"][1], 2),
            dis_customers_count=categories["DIS"][0],
            dis_pending_amount=round(categories["DIS"][1], 2),
            other_customers_count=categories["OTHER"][0],
            other_pending_amount=round(categories["OTHER"][1], 2),
            nearby_pending_customers=nearby
        )
        await cache_service.set(cache_key, metrics.model_dump(), ttl=60)
        return metrics
    except Exception as e:
        logger.error(f"Error compiling officer dashboard metrics: {e}")
        return OfficerDashboardMetrics(
            total_assigned_customers=0,
            total_pending_amount=0.0,
            number_of_pending_bills=0,
            number_of_completed_collections=0,
            todays_collection_target=30000.0,
            todays_collected_amount=0.0,
            remaining_collections_count=0,
            remaining_collections_amount=0.0,
            nearby_pending_customers=[]
        )
