from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, func, desc, case
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
from app.utils.dependencies import get_current_user, get_or_create_officer_context

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
        officer_ctx = await get_or_create_officer_context(db, current_user)
        officer_doc = officer_ctx["officer_doc"]
        officer_id = officer_ctx["officer_id"]
        filter_ids = list(officer_ctx["filter_ids"])

        lat_rounded = round(latitude or 21.1458, 3)
        lng_rounded = round(longitude or 79.0882, 3)
        cache_key = f"dashboard:officer:{officer_id}:{lat_rounded}:{lng_rounded}"

        cached_metrics = await cache_service.get(cache_key)
        if cached_metrics:
            return OfficerDashboardMetrics(**cached_metrics)

        today_date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Build customer filter strictly for this officer
        officer_cus_conds = [
            or_(
                Customer.assigned_officer_id.in_(filter_ids),
                Customer.uploaded_by_officer_id.in_(filter_ids)
            )
        ]

        is_pending = Customer.status.in_(["pending", "overdue", "partially_paid"])
        is_paid = (Customer.status == "paid")
        is_td = or_(Customer.disconnection_status.ilike("%TD%"), Customer.status.ilike("%TD%"))
        is_pd = and_(~is_td, or_(Customer.disconnection_status.ilike("%PD%"), Customer.status.ilike("%PD%")))
        is_bur = and_(~is_td, ~is_pd, or_(Customer.disconnection_status.ilike("%BUR%"), Customer.status.ilike("%BUR%")))
        is_dis = and_(~is_td, ~is_pd, ~is_bur, or_(Customer.disconnection_status.ilike("%DIS%"), Customer.status.ilike("%DIS%")))
        is_other = and_(~is_td, ~is_pd, ~is_bur, ~is_dis)

        # Single consolidated query for all customer metrics
        stats_stmt = select(
            func.count(Customer.id).label("total_assigned"),
            func.count(case((is_pending, Customer.id))).label("pending_count"),
            func.coalesce(func.sum(case((is_pending, func.coalesce(Customer.pending_amount, 0.0)), else_=0.0)), 0.0).label("pending_amount"),
            func.count(case((is_paid, Customer.id))).label("paid_count"),
            func.count(case((is_td, Customer.id))).label("td_count"),
            func.coalesce(func.sum(case((is_td, func.coalesce(Customer.pending_amount, 0.0)), else_=0.0)), 0.0).label("td_amount"),
            func.count(case((is_pd, Customer.id))).label("pd_count"),
            func.coalesce(func.sum(case((is_pd, func.coalesce(Customer.pending_amount, 0.0)), else_=0.0)), 0.0).label("pd_amount"),
            func.count(case((is_bur, Customer.id))).label("bur_count"),
            func.coalesce(func.sum(case((is_bur, func.coalesce(Customer.pending_amount, 0.0)), else_=0.0)), 0.0).label("bur_amount"),
            func.count(case((is_dis, Customer.id))).label("dis_count"),
            func.coalesce(func.sum(case((is_dis, func.coalesce(Customer.pending_amount, 0.0)), else_=0.0)), 0.0).label("dis_amount"),
            func.count(case((is_other, Customer.id))).label("other_count"),
            func.coalesce(func.sum(case((is_other, func.coalesce(Customer.pending_amount, 0.0)), else_=0.0)), 0.0).label("other_amount"),
        ).where(and_(*officer_cus_conds))

        stats_row = (await db.execute(stats_stmt)).first()

        total_assigned = stats_row[0] or 0 if stats_row else 0
        pending_count = stats_row[1] or 0 if stats_row else 0
        total_pending_amount = float(stats_row[2] or 0.0) if stats_row else 0.0
        paid_count = stats_row[3] or 0 if stats_row else 0
        td_count = stats_row[4] or 0 if stats_row else 0
        td_amount = float(stats_row[5] or 0.0) if stats_row else 0.0
        pd_count = stats_row[6] or 0 if stats_row else 0
        pd_amount = float(stats_row[7] or 0.0) if stats_row else 0.0
        bur_count = stats_row[8] or 0 if stats_row else 0
        bur_amount = float(stats_row[9] or 0.0) if stats_row else 0.0
        dis_count = stats_row[10] or 0 if stats_row else 0
        dis_amount = float(stats_row[11] or 0.0) if stats_row else 0.0
        other_count = stats_row[12] or 0 if stats_row else 0
        other_amount = float(stats_row[13] or 0.0) if stats_row else 0.0

        # Category collection stats by joining Payment with Customer on unique customer_id
        pmt_stats_stmt = select(
            func.coalesce(func.sum(case((is_td, Payment.amount), else_=0.0)), 0.0).label("td_collected"),
            func.coalesce(func.sum(case((is_pd, Payment.amount), else_=0.0)), 0.0).label("pd_collected"),
            func.coalesce(func.sum(case((is_bur, Payment.amount), else_=0.0)), 0.0).label("bur_collected"),
            func.coalesce(func.sum(case((is_dis, Payment.amount), else_=0.0)), 0.0).label("dis_collected"),
            func.coalesce(func.sum(case((is_other, Payment.amount), else_=0.0)), 0.0).label("other_collected"),
            func.count(func.distinct(case((is_other, Customer.id)))).label("other_collected_count"),
            func.coalesce(func.sum(case((is_other, func.coalesce(Customer.pending_amount, 0.0)), else_=0.0)), 0.0).label("other_collected_pending"),
        ).select_from(Payment).join(
            Customer,
            Payment.customer_id == Customer.customer_id
        ).where(and_(*officer_cus_conds))
        pmt_stats_row = (await db.execute(pmt_stats_stmt)).first()

        td_collected = float(pmt_stats_row[0] or 0.0) if pmt_stats_row else 0.0
        pd_collected = float(pmt_stats_row[1] or 0.0) if pmt_stats_row else 0.0
        bur_collected = float(pmt_stats_row[2] or 0.0) if pmt_stats_row else 0.0
        dis_collected = float(pmt_stats_row[3] or 0.0) if pmt_stats_row else 0.0
        other_collected = float(pmt_stats_row[4] or 0.0) if pmt_stats_row else 0.0
        # For NC (Normally Collected), only report consumers with collected payments
        other_count = int(pmt_stats_row[5] or 0) if pmt_stats_row else 0
        other_amount = float(pmt_stats_row[6] or 0.0) if pmt_stats_row else 0.0

        # Total collected amount by this officer directly from Payment table
        total_pmt_stmt = select(
            func.coalesce(func.sum(Payment.amount), 0.0)
        ).where(Payment.officer_id.in_(filter_ids))
        total_collected_amount = float((await db.execute(total_pmt_stmt)).scalar() or 0.0)

        # Today's collected amount & count
        pmt_conds = [
            Payment.created_at.like(f"{today_date_str}%"),
            Payment.officer_id.in_(filter_ids)
        ]
        pmt_stmt = select(
            func.count(Payment.id),
            func.coalesce(func.sum(Payment.amount), 0.0)
        ).where(and_(*pmt_conds))
        pmt_row = (await db.execute(pmt_stmt)).first()
        today_collections_count = pmt_row[0] if pmt_row else 0
        today_collected_amount = float(pmt_row[1]) if pmt_row else 0.0

        # Targets
        target_amount = float(officer_doc.target_collection_amount) if officer_doc and officer_doc.target_collection_amount else 30000.0
        remaining_collections_count = max(0, pending_count)
        remaining_collections_amount = max(0.0, total_pending_amount)

        # Fetch nearby pending customers via PostGIS
        nearby = await CustomerService.get_nearby_customers(
            db=db,
            latitude=latitude or 21.1458,
            longitude=longitude or 79.0882,
            radius_meters=5000.0,
            status_filter=None,
            officer_id=filter_ids,
            limit=10
        )

        metrics = OfficerDashboardMetrics(
            total_assigned_customers=total_assigned,
            total_pending_amount=round(total_pending_amount, 2),
            number_of_pending_bills=pending_count,
            number_of_completed_collections=paid_count,
            todays_collection_target=target_amount,
            todays_collected_amount=round(today_collected_amount, 2),
            total_collected_amount=round(total_collected_amount, 2),
            remaining_collections_count=remaining_collections_count,
            remaining_collections_amount=round(remaining_collections_amount, 2),
            td_customers_count=td_count,
            td_pending_amount=round(td_amount, 2),
            td_collected_amount=round(td_collected, 2),
            pd_customers_count=pd_count,
            pd_pending_amount=round(pd_amount, 2),
            pd_collected_amount=round(pd_collected, 2),
            bur_customers_count=bur_count,
            bur_pending_amount=round(bur_amount, 2),
            bur_collected_amount=round(bur_collected, 2),
            dis_customers_count=dis_count,
            dis_pending_amount=round(dis_amount, 2),
            dis_collected_amount=round(dis_collected, 2),
            other_customers_count=other_count,
            other_pending_amount=round(other_amount, 2),
            other_collected_amount=round(other_collected, 2),
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
