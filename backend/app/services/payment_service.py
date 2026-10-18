from datetime import datetime, timezone
from uuid import uuid4
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict, Any

from app.models.customer import Customer
from app.models.payment import Payment
from app.models.audit import AuditLog
from app.database import point_wkt
from app.schemas.payment import PaymentCollectRequest, PaymentResponse

class PaymentService:

    @staticmethod
    async def collect_payment(
        db: AsyncSession,
        request: PaymentCollectRequest,
        officer: Dict[str, Any]
    ) -> PaymentResponse:
        # 1. Fetch Target Customer
        stmt = select(Customer).where(Customer.customer_id == request.customer_id)
        customer = (await db.execute(stmt)).scalar_one_or_none()
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with ID '{request.customer_id}' not found."
            )

        current_pending = float(customer.pending_amount or 0.0)
        if current_pending <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This customer has no pending balance."
            )

        collected_amount = float(request.amount)
        if collected_amount > current_pending:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Collected amount (₹{collected_amount}) cannot exceed current pending balance (₹{current_pending})."
            )

        # 2. Calculate remaining pending balance
        new_pending = current_pending - collected_amount
        new_status = "paid" if new_pending <= 0.01 else "partially_paid"

        now_str = datetime.now(timezone.utc).isoformat()
        today_date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        
        # 3. Create Payment Transaction Record
        payment_id = f"PAY-{uuid4().hex[:8].upper()}"
        receipt_number = f"REC-{today_date_str}-{uuid4().hex[:6].upper()}"

        customer_name = customer.name or "Unknown Customer"
        meter_number = customer.meter_number or ""

        officer_name = officer.get("full_name", "Field Officer")
        officer_id = officer.get("officer_id", str(officer.get("_id")))

        disconn_status = request.disconnection_status
        if not disconn_status and request.payment_method.lower() in ["td", "pd", "bur", "dis", "other"]:
            disconn_status = request.payment_method.upper()

        pt_geom = None
        if request.collection_latitude is not None and request.collection_longitude is not None:
            pt_geom = point_wkt(request.collection_longitude, request.collection_latitude)

        payment = Payment(
            payment_id=payment_id,
            receipt_number=receipt_number,
            bill_id=request.bill_id,
            customer_id=request.customer_id,
            customer_name=customer_name,
            meter_id=request.meter_id,
            meter_number=meter_number,
            officer_id=officer_id,
            officer_name=officer_name,
            amount=collected_amount,
            payment_method=request.payment_method.lower(),
            disconnection_status=disconn_status,
            transaction_reference=request.transaction_reference,
            remarks=request.remarks,
            collection_latitude=request.collection_latitude,
            collection_longitude=request.collection_longitude,
            collection_location=pt_geom,
            previous_pending_amount=current_pending,
            remaining_pending_amount=max(0.0, new_pending),
            bill_status=new_status,
            created_at=now_str
        )
        db.add(payment)

        # 4. Update Customer in PostgreSQL
        customer.pending_amount = max(0.0, new_pending)
        customer.status = new_status
        customer.updated_at = now_str
        if disconn_status:
            customer.disconnection_status = disconn_status

        # 5. Record Audit Log
        audit = AuditLog(
            action="PAYMENT_COLLECTED",
            user_id=str(officer.get("_id")),
            officer_id=officer_id,
            details={
                "amount": collected_amount,
                "payment_method": request.payment_method,
                "customer_id": request.customer_id,
                "receipt_number": receipt_number
            },
            timestamp=now_str
        )
        db.add(audit)

        await db.commit()
        await db.refresh(payment)

        return PaymentResponse(
            id=str(payment.id),
            receipt_number=receipt_number,
            payment_id=payment_id,
            bill_id=request.bill_id,
            customer_id=request.customer_id,
            customer_name=customer_name,
            meter_id=request.meter_id,
            meter_number=meter_number,
            officer_id=officer_id,
            officer_name=officer_name,
            amount=collected_amount,
            payment_method=request.payment_method,
            disconnection_status=disconn_status,
            transaction_reference=request.transaction_reference,
            remarks=request.remarks,
            collection_latitude=request.collection_latitude,
            collection_longitude=request.collection_longitude,
            previous_pending_amount=current_pending,
            remaining_pending_amount=max(0.0, new_pending),
            bill_status=new_status,
            created_at=now_str
        )
