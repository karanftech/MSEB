from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, desc
from typing import List, Optional

from app.database import get_db
from app.models.payment import Payment
from app.models.customer import Customer
from app.schemas.payment import PaymentCollectRequest, PaymentResponse, ReceiptData
from app.services.payment_service import PaymentService
from app.services.cache_service import cache_service
from app.utils.dependencies import get_current_user, require_officer

router = APIRouter(prefix="/api/payments", tags=["Payments"])

@router.post("/collect", response_model=PaymentResponse)
async def collect_payment(
    request: PaymentCollectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_officer)
):
    result = await PaymentService.collect_payment(db=db, request=request, officer=current_user)
    await cache_service.clear_prefix("customers:")
    await cache_service.clear_prefix("dashboard:")
    return result

@router.get("", response_model=List[PaymentResponse])
async def list_payments(
    customer_id: Optional[str] = Query(None),
    officer_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    stmt = select(Payment)
    if customer_id:
        stmt = stmt.where(Payment.customer_id == customer_id)
    if officer_id:
        stmt = stmt.where(Payment.officer_id == officer_id)

    stmt = stmt.order_by(desc(Payment.created_at)).limit(limit)
    payments_docs = (await db.execute(stmt)).scalars().all()

    results = []
    for p in payments_docs:
        results.append(
            PaymentResponse(
                id=str(p.id),
                receipt_number=p.receipt_number or "",
                payment_id=p.payment_id or "",
                bill_id=p.bill_id,
                customer_id=p.customer_id,
                customer_name=p.customer_name,
                meter_id=p.meter_id,
                meter_number=p.meter_number,
                officer_id=p.officer_id or "",
                officer_name=p.officer_name,
                amount=float(p.amount or 0.0),
                payment_method=p.payment_method or "cash",
                disconnection_status=p.disconnection_status,
                transaction_reference=p.transaction_reference,
                remarks=p.remarks,
                collection_latitude=p.collection_latitude,
                collection_longitude=p.collection_longitude,
                previous_pending_amount=float(p.previous_pending_amount or 0.0),
                remaining_pending_amount=float(p.remaining_pending_amount or 0.0),
                bill_status=p.bill_status or "paid",
                created_at=p.created_at or ""
            )
        )
    return results

@router.get("/{payment_id}/receipt", response_model=ReceiptData)
async def get_receipt(
    payment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    stmt = select(Payment).where(
        or_(Payment.payment_id == payment_id, Payment.receipt_number == payment_id)
    )
    p = (await db.execute(stmt)).scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Payment record not found")

    cus_stmt = select(Customer).where(Customer.customer_id == p.customer_id)
    cus = (await db.execute(cus_stmt)).scalar_one_or_none()
    address = cus.address if cus else ""

    return ReceiptData(
        organization_name="State Electricity Department - Field Collection Portal",
        receipt_number=p.receipt_number or "",
        date_time=p.created_at or "",
        customer_name=p.customer_name or "Valued Consumer",
        customer_id=p.customer_id,
        meter_number=p.meter_number or "N/A",
        address=address,
        collected_amount=float(p.amount or 0.0),
        payment_method=(p.payment_method or "").upper(),
        transaction_reference=p.transaction_reference or "N/A (Cash)",
        field_officer_name=p.officer_name or "Field Officer",
        field_officer_id=p.officer_id or "",
        previous_pending=float(p.previous_pending_amount or 0.0),
        remaining_balance=float(p.remaining_pending_amount or 0.0),
        status=(p.bill_status or "paid").upper()
    )
