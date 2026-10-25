from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, desc
from typing import Optional, Any

from app.database import get_db
from app.models.customer import Customer
from app.models.officer import Officer
from app.models.payment import Payment
from app.utils.dependencies import get_current_user, get_or_create_officer_context

router = APIRouter(prefix="/api/reports", tags=["Reports"])

def safe_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

@router.get("/field-performance")
async def get_field_performance_report(
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    officer_ctx = await get_or_create_officer_context(db, current_user)
    filter_ids = list(officer_ctx["filter_ids"])

    cus_conds = [
        or_(
            Customer.assigned_officer_id.in_(filter_ids),
            Customer.uploaded_by_officer_id.in_(filter_ids)
        )
    ]
    pmt_conds = [
        Payment.officer_id.in_(filter_ids)
    ]

    cus_stmt = select(Customer)
    if cus_conds:
        cus_stmt = cus_stmt.where(and_(*cus_conds))
    all_customers = (await db.execute(cus_stmt)).scalars().all()
    total_assigned = len(all_customers)

    pmt_stmt = select(Payment)
    if pmt_conds:
        pmt_stmt = pmt_stmt.where(and_(*pmt_conds))
    pmt_stmt = pmt_stmt.order_by(desc(Payment.created_at))
    payment_docs = (await db.execute(pmt_stmt)).scalars().all()

    cus_name_map = {c.customer_id: c.name for c in all_customers if c.customer_id}

    visit_docs = []
    for p in payment_docs:
        cid = p.customer_id or "N/A"
        cname = cus_name_map.get(cid) or p.customer_name or cid
        lat = p.collection_latitude or 21.1458
        lng = p.collection_longitude or 79.0882
        visit_docs.append({
            "visit_id": p.payment_id or str(p.id),
            "date_time": p.created_at or "",
            "consumer_id": cid,
            "consumer_name": cname,
            "meter_id": p.meter_number or p.meter_id or "N/A",
            "status": "Payment Recovered",
            "amount_collected": float(p.amount or 0.0),
            "officer_remarks": p.remarks or "Payment collected",
            "gps_position": f"{lat:.4f}, {lng:.4f}",
            "ward_name": "Central Ward"
        })

    visited_consumer_ids = set(v["consumer_id"] for v in visit_docs if v.get("consumer_id"))
    total_visited = len(visited_consumer_ids)
    total_visits = len(visit_docs)
    unvisited_remaining = max(0, total_assigned - total_visited)

    total_recovered = sum(safe_float(v.get("amount_collected")) for v in visit_docs if v.get("status") == "Payment Recovered")
    pending_customers = [c for c in all_customers if (c.status or "") in ["pending", "overdue", "partially_paid"]]
    outstanding_balance = sum(safe_float(c.pending_amount) for c in pending_customers)

    total_ward_demand = total_recovered + outstanding_balance
    recovery_rate = round((total_recovered / total_ward_demand * 100.0), 1) if total_ward_demand > 0 else 0.0

    # Group outcomes consistently by unique consumer accounts visited
    status_counts = {
        "Payment Recovered": len(set(v["consumer_id"] for v in visit_docs if v.get("status") == "Payment Recovered")),
        "Not Recovered": len(set(v["consumer_id"] for v in visit_docs if v.get("status") == "Not Recovered")),
        "Contacted": len(set(v["consumer_id"] for v in visit_docs if v.get("status") == "Contacted")),
        "Unavailable": len(set(v["consumer_id"] for v in visit_docs if v.get("status") == "Unavailable")),
        "Meter Issue": len(set(v["consumer_id"] for v in visit_docs if v.get("status") == "Meter Issue")),
        "NC (Normally Collected)": len(set(v["consumer_id"] for v in visit_docs if v.get("status") in ["NC (Normally Collected)", "Other / Followup"])),
        "Other / Followup": len(set(v["consumer_id"] for v in visit_docs if v.get("status") in ["NC (Normally Collected)", "Other / Followup"])),
    }

    filtered_visits = visit_docs
    if status_filter and status_filter != "All Statuses":
        filtered_visits = [v for v in filtered_visits if v.get("status") == status_filter]

    if search:
        s_lower = search.lower()
        filtered_visits = [
            v for v in filtered_visits
            if s_lower in str(v.get("consumer_id", "")).lower()
            or s_lower in str(v.get("consumer_name", "")).lower()
            or s_lower in str(v.get("meter_id", "")).lower()
            or s_lower in str(v.get("officer_remarks", "")).lower()
            or s_lower in str(v.get("status", "")).lower()
        ]

    return {
        "kpis": {
            "consumers_visited_count": total_visited,
            "total_visits_count": total_visits,
            "total_assigned_consumers": total_assigned,
            "unvisited_consumers_remaining": unvisited_remaining,
            "total_recovered": round(total_recovered, 2),
            "outstanding_balance": round(outstanding_balance, 2),
            "recovery_rate": recovery_rate
        },
        "breakdown": status_counts,
        "visits": filtered_visits,
        "ward_name": "Central Ward"
    }
