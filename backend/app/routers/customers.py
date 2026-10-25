from fastapi import APIRouter, Depends, HTTPException, Query, status, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, func, delete
from typing import List, Optional, Dict, Any
from collections import defaultdict
from datetime import datetime, timezone
from uuid import uuid4

from app.database import get_db, point_wkt
from app.models.customer import Customer
from app.models.meter import Meter
from app.models.officer import Officer
from app.models.payment import Payment
from app.schemas.customer import (
    CustomerCreate,
    CustomerUpdate,
    CustomerResponse,
    NearbyCustomerResponse,
    MeterSchema,
    DTCCodeOption,
    DTCCodesResponse,
)
from app.services.customer_service import CustomerService
from app.services.customer_import_service import CustomerImportService
from app.services.cache_service import cache_service
from app.utils.dependencies import get_current_user, get_or_create_officer_context

router = APIRouter(prefix="/api/customers", tags=["Customers"])

@router.get("/nearby", response_model=List[NearbyCustomerResponse])
async def get_nearby_customers(
    latitude: float = Query(..., description="Current latitude of officer"),
    longitude: float = Query(..., description="Current longitude of officer"),
    radius: float = Query(5000.0, description="Search radius in meters"),
    status: Optional[str] = Query(None, description="Status filter (pending, overdue, paid)"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    officer_ctx = await get_or_create_officer_context(db, current_user)
    is_admin = current_user.get("role") == "admin"
    officer_filter = None if is_admin else list(officer_ctx["filter_ids"])

    return await CustomerService.get_nearby_customers(
        db=db,
        latitude=latitude,
        longitude=longitude,
        radius_meters=radius,
        status_filter=status,
        officer_id=officer_filter
    )

@router.get("/dtc-codes", response_model=DTCCodesResponse)
async def get_dtc_codes(
    all_officers: Optional[bool] = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get dynamic distinct DTC codes and meter counts for the authenticated field officer."""
    officer_ctx = await get_or_create_officer_context(db, current_user)
    is_admin = current_user.get("role") == "admin"
    filter_ids = list(officer_ctx["filter_ids"])

    cache_key = f"dtc_codes:{officer_ctx['officer_id']}:{all_officers if is_admin else False}"

    cached = await cache_service.get(cache_key)
    if cached:
        return DTCCodesResponse(**cached)

    stmt = select(
        Customer.dtc_code,
        func.count(Customer.id).label("meter_count")
    ).where(
        Customer.dtc_code.isnot(None),
        Customer.dtc_code != "",
        Customer.dtc_code != "null",
        Customer.dtc_code != "NaN"
    )

    if not is_admin or not all_officers:
        stmt = stmt.where(
            or_(
                Customer.assigned_officer_id.in_(filter_ids),
                Customer.uploaded_by_officer_id.in_(filter_ids)
            )
        )

    stmt = stmt.group_by(Customer.dtc_code).order_by(Customer.dtc_code)
    results = (await db.execute(stmt)).all()

    dtc_options = [
        DTCCodeOption(code=str(code), meter_count=int(cnt))
        for code, cnt in results if code
    ]
    total_meters = sum(opt.meter_count for opt in dtc_options)

    response_data = DTCCodesResponse(
        total_dtcs=len(dtc_options),
        total_meters=total_meters,
        dtcs=dtc_options
    )
    await cache_service.set(cache_key, response_data.model_dump(), ttl=120)
    return response_data

@router.get("", response_model=List[CustomerResponse])
async def list_customers(
    area: Optional[str] = Query(None),
    dtc_code: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    disconnection_status: Optional[str] = Query(None),
    min_amount: Optional[float] = Query(None),
    max_amount: Optional[float] = Query(None),
    assigned_officer_id: Optional[str] = Query(None),
    all_officers: Optional[bool] = Query(False),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    officer_ctx = await get_or_create_officer_context(db, current_user)
    is_admin = current_user.get("role") == "admin"
    filter_ids = list(officer_ctx["filter_ids"])

    cache_key = (
        f"customers:list:{officer_ctx['officer_id']}:{all_officers if is_admin else False}:{assigned_officer_id or ''}:"
        f"{area or ''}:{dtc_code or ''}:{status or ''}:{disconnection_status or ''}:"
        f"{min_amount or ''}:{max_amount or ''}:{search or ''}:{skip}:{limit}"
    )

    cached_list = await cache_service.get(cache_key)
    if cached_list is not None:
        return [CustomerResponse(**item) for item in cached_list]

    conditions = []

    if is_admin:
        if assigned_officer_id:
            conditions.append(
                or_(
                    Customer.assigned_officer_id == assigned_officer_id,
                    Customer.uploaded_by_officer_id == assigned_officer_id
                )
            )
        elif not all_officers:
            conditions.append(
                or_(
                    Customer.assigned_officer_id.in_(filter_ids),
                    Customer.uploaded_by_officer_id.in_(filter_ids)
                )
            )
    else:
        # Non-admin / Field officer is strictly scoped to their own data only!
        conditions.append(
            or_(
                Customer.assigned_officer_id.in_(filter_ids),
                Customer.uploaded_by_officer_id.in_(filter_ids)
            )
        )

    if dtc_code and dtc_code.lower() != 'all':
        conditions.append(Customer.dtc_code == dtc_code)

    if area:
        conditions.append(Customer.area == area)

    if status:
        conditions.append(Customer.status == status)

    if disconnection_status and disconnection_status.lower() != 'all':
        ds = disconnection_status.upper()
        conditions.append(
            or_(
                Customer.disconnection_status == ds,
                Customer.disconnection_status == ds.lower(),
                Customer.status == ds,
                Customer.status == ds.lower()
            )
        )

    if min_amount is not None:
        conditions.append(Customer.pending_amount >= min_amount)
    if max_amount is not None:
        conditions.append(Customer.pending_amount <= max_amount)

    if search:
        search_pattern = f"%{search}%"
        conditions.append(
            or_(
                Customer.name.ilike(search_pattern),
                Customer.customer_id.ilike(search_pattern),
                Customer.meter_number.ilike(search_pattern),
                Customer.address.ilike(search_pattern),
                Customer.phone.ilike(search_pattern)
            )
        )

    stmt = select(Customer)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.offset(skip).limit(limit)

    customers_docs = (await db.execute(stmt)).scalars().all()
    if not customers_docs:
        return []

    # Batch fetch meters and payments
    customer_ids = [c.customer_id for c in customers_docs if c.customer_id]
    m_stmt = select(Meter).where(Meter.customer_id.in_(customer_ids))
    all_meters_docs = (await db.execute(m_stmt)).scalars().all()

    # Batch fetch payments for accurate per-customer collected amounts
    p_stmt = select(
        Payment.customer_id,
        func.coalesce(func.sum(Payment.amount), 0.0)
    ).where(Payment.customer_id.in_(customer_ids)).group_by(Payment.customer_id)
    payments_by_cust = dict((await db.execute(p_stmt)).all())

    meters_by_customer = defaultdict(list)
    for m in all_meters_docs:
        meters_by_customer[m.customer_id].append(
            MeterSchema(
                meter_id=m.meter_id,
                meter_number=m.meter_number,
                customer_id=m.customer_id,
                latitude=float(m.latitude or 0.0),
                longitude=float(m.longitude or 0.0),
                dtc_code=m.dtc_code,
                assigned_officer_id=m.assigned_officer_id,
                assigned_officer_name=m.assigned_officer_name,
                uploaded_by_officer_id=m.uploaded_by_officer_id
            )
        )

    results = []
    for cus in customers_docs:
        meters = meters_by_customer.get(cus.customer_id, [])
        c_lat = float(cus.latitude or 0.0)
        c_lng = float(cus.longitude or 0.0)
        c_dtc = cus.dtc_code

        if (c_lat == 0.0 or c_lng == 0.0) and meters:
            for m in meters:
                if m.latitude != 0.0 and m.longitude != 0.0:
                    c_lat, c_lng = m.latitude, m.longitude
                    break

        if not c_dtc and meters:
            for m in meters:
                if m.dtc_code:
                    c_dtc = m.dtc_code
                    break

        results.append(
            CustomerResponse(
                id=str(cus.id),
                customer_id=cus.customer_id,
                name=cus.name,
                meter_number=cus.meter_number or "",
                phone=cus.phone or "",
                email=cus.email,
                address=cus.address or "",
                area=cus.area or "",
                latitude=c_lat,
                longitude=c_lng,
                dtc_code=c_dtc,
                disconnection_status=cus.disconnection_status,
                pending_amount=float(cus.pending_amount or 0.0),
                collected_amount=float(payments_by_cust.get(cus.customer_id, 0.0)),
                due_date=cus.due_date,
                pending_days=cus.pending_days,
                status=cus.status or "pending",
                priority=cus.priority or "normal",
                assigned_officer_id=cus.assigned_officer_id,
                assigned_officer_name=cus.assigned_officer_name,
                uploaded_by_officer_id=cus.uploaded_by_officer_id,
                meters=meters,
                created_at=str(cus.created_at or ""),
                updated_at=str(cus.updated_at or "")
            )
        )

    await cache_service.set(cache_key, [c.model_dump() for c in results], ttl=60)
    return results

async def invalidate_customer_caches():
    """Purge cached customer lists, DTC filters, dashboard metrics, reports, and payments on data change."""
    await cache_service.clear_prefix("customers:")
    await cache_service.clear_prefix("dashboard:")
    await cache_service.clear_prefix("dtc_codes:")
    await cache_service.clear_prefix("reports:")
    await cache_service.clear_prefix("payments:")

@router.post("", response_model=CustomerResponse)
async def create_customer(
    request: CustomerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    officer_ctx = await get_or_create_officer_context(db, current_user)
    assigned_officer_id = request.assigned_officer_id or officer_ctx["officer_id"]
    assigned_officer_name = officer_ctx["officer_name"]
    filter_ids = list(officer_ctx["filter_ids"])

    stmt = select(Customer).where(
        and_(
            Customer.customer_id == request.customer_id,
            or_(
                Customer.uploaded_by_officer_id.in_(filter_ids),
                Customer.assigned_officer_id.in_(filter_ids)
            )
        )
    )
    existing = (await db.execute(stmt)).scalars().first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Customer ID '{request.customer_id}' already exists in your roster.")

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    if request.assigned_officer_id and request.assigned_officer_id != officer_ctx["officer_id"]:
        res = await db.execute(select(Officer).where(Officer.officer_id == request.assigned_officer_id))
        off_doc = res.scalar_one_or_none()
        if off_doc:
            assigned_officer_name = off_doc.full_name

    if not request.dtc_code or not str(request.dtc_code).strip():
        raise HTTPException(status_code=400, detail="DTC code is required.")
    dtc_code = CustomerImportService.normalize_dtc_code(request.dtc_code)

    status_val = request.status or ("overdue" if (request.pending_amount or 0) > 3000 else ("pending" if (request.pending_amount or 0) > 0 else "paid"))
    priority_val = request.priority or ("high" if (request.pending_amount or 0) > 5000 else "normal")

    pt_geom = point_wkt(request.longitude, request.latitude)
    customer = Customer(
        customer_id=request.customer_id,
        name=request.name,
        phone=request.phone,
        email=request.email,
        address=request.address,
        area=request.area,
        latitude=request.latitude,
        longitude=request.longitude,
        location=pt_geom,
        meter_number=request.meter_number,
        dtc_code=dtc_code,
        pending_amount=float(request.pending_amount or 0.0),
        due_date=request.due_date,
        pending_days=str(request.pending_days) if request.pending_days is not None else None,
        status=status_val,
        priority=priority_val,
        assigned_officer_id=assigned_officer_id,
        assigned_officer_name=assigned_officer_name,
        uploaded_by_officer_id=request.uploaded_by_officer_id or assigned_officer_id,
        created_at=now_str,
        updated_at=now_str
    )
    db.add(customer)

    meter_id = f"MTR-{uuid4().hex[:6].upper()}"
    meter = Meter(
        meter_id=meter_id,
        meter_number=request.meter_number,
        customer_id=request.customer_id,
        latitude=request.latitude,
        longitude=request.longitude,
        location=pt_geom,
        dtc_code=dtc_code,
        assigned_officer_id=assigned_officer_id,
        assigned_officer_name=assigned_officer_name,
        uploaded_by_officer_id=customer.uploaded_by_officer_id,
        created_at=now_str,
        updated_at=now_str
    )
    db.add(meter)
    await db.commit()
    await db.refresh(customer)
    await invalidate_customer_caches()

    return CustomerResponse(
        id=str(customer.id),
        customer_id=customer.customer_id,
        name=customer.name,
        meter_number=customer.meter_number,
        phone=customer.phone or "",
        email=customer.email,
        address=customer.address,
        area=customer.area,
        latitude=customer.latitude,
        longitude=customer.longitude,
        dtc_code=dtc_code,
        disconnection_status=customer.disconnection_status,
        pending_amount=customer.pending_amount,
        due_date=customer.due_date,
        pending_days=customer.pending_days,
        status=customer.status,
        priority=customer.priority,
        assigned_officer_id=assigned_officer_id,
        assigned_officer_name=assigned_officer_name,
        uploaded_by_officer_id=customer.uploaded_by_officer_id,
        meters=[
            MeterSchema(
                meter_id=meter.meter_id,
                meter_number=meter.meter_number,
                customer_id=meter.customer_id,
                latitude=meter.latitude,
                longitude=meter.longitude,
                dtc_code=dtc_code,
                assigned_officer_id=assigned_officer_id,
                assigned_officer_name=assigned_officer_name,
                uploaded_by_officer_id=customer.uploaded_by_officer_id
            )
        ],
        created_at=now_str,
        updated_at=now_str
    )

@router.get("/{customer_id}", response_model=CustomerResponse)
async def get_customer(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    officer_ctx = await get_or_create_officer_context(db, current_user)
    is_admin = (current_user.get("role") == "admin")
    filter_ids = list(officer_ctx["filter_ids"])

    stmt = select(Customer).where(Customer.customer_id == customer_id)
    if not is_admin:
        stmt = stmt.where(
            or_(
                Customer.assigned_officer_id.in_(filter_ids),
                Customer.uploaded_by_officer_id.in_(filter_ids)
            )
        )
    cus = (await db.execute(stmt)).scalars().first()
    if not cus:
        raise HTTPException(status_code=404, detail="Customer not found")

    m_stmt = select(Meter).where(Meter.customer_id == customer_id)
    if not is_admin:
        m_stmt = m_stmt.where(
            or_(
                Meter.assigned_officer_id.in_(filter_ids),
                Meter.uploaded_by_officer_id.in_(filter_ids)
            )
        )
    meters_docs = (await db.execute(m_stmt)).scalars().all()

    meters = [
        MeterSchema(
            meter_id=m.meter_id,
            meter_number=m.meter_number,
            customer_id=m.customer_id,
            latitude=float(m.latitude or 0.0),
            longitude=float(m.longitude or 0.0),
            dtc_code=m.dtc_code,
            assigned_officer_id=m.assigned_officer_id,
            assigned_officer_name=m.assigned_officer_name,
            uploaded_by_officer_id=m.uploaded_by_officer_id
        )
        for m in meters_docs
    ]

    return CustomerResponse(
        id=str(cus.id),
        customer_id=cus.customer_id,
        name=cus.name,
        meter_number=cus.meter_number or "",
        phone=cus.phone or "",
        email=cus.email,
        address=cus.address or "",
        area=cus.area or "",
        latitude=float(cus.latitude or 0.0),
        longitude=float(cus.longitude or 0.0),
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
        meters=meters,
        created_at=str(cus.created_at or ""),
        updated_at=str(cus.updated_at or "")
    )

@router.put("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: str,
    request: CustomerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    officer_ctx = await get_or_create_officer_context(db, current_user)
    is_admin = (current_user.get("role") == "admin")
    filter_ids = list(officer_ctx["filter_ids"])

    stmt = select(Customer).where(Customer.customer_id == customer_id)
    if not is_admin:
        stmt = stmt.where(
            or_(
                Customer.assigned_officer_id.in_(filter_ids),
                Customer.uploaded_by_officer_id.in_(filter_ids)
            )
        )
    cus = (await db.execute(stmt)).scalars().first()
    if not cus:
        raise HTTPException(status_code=404, detail="Customer not found")

    if request.name is not None:
        cus.name = request.name
    if request.phone is not None:
        cus.phone = request.phone
    if request.email is not None:
        cus.email = request.email
    if request.address is not None:
        cus.address = request.address
    if request.area is not None:
        cus.area = request.area
    if request.latitude is not None and request.longitude is not None:
        cus.latitude = request.latitude
        cus.longitude = request.longitude
        cus.location = point_wkt(request.longitude, request.latitude)
    if request.dtc_code is not None:
        cus.dtc_code = CustomerImportService.normalize_dtc_code(request.dtc_code)
    if request.disconnection_status is not None:
        cus.disconnection_status = request.disconnection_status
    if request.pending_days is not None:
        cus.pending_days = str(request.pending_days)
    if request.assigned_officer_id is not None:
        cus.assigned_officer_id = request.assigned_officer_id
    if request.status is not None:
        cus.status = request.status

    cus.updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    await db.commit()
    await db.refresh(cus)
    await invalidate_customer_caches()

    return await get_customer(customer_id=customer_id, db=db, current_user=current_user)

@router.delete("/{customer_id}")
async def delete_customer(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    officer_ctx = await get_or_create_officer_context(db, current_user)
    is_admin = (current_user.get("role") == "admin")
    filter_ids = list(officer_ctx["filter_ids"])

    stmt = select(Customer).where(Customer.customer_id == customer_id)
    if not is_admin:
        stmt = stmt.where(
            or_(
                Customer.assigned_officer_id.in_(filter_ids),
                Customer.uploaded_by_officer_id.in_(filter_ids)
            )
        )
    cus = (await db.execute(stmt)).scalars().first()
    if not cus:
        raise HTTPException(status_code=404, detail="Customer not found in your assigned records")

    await db.execute(delete(Customer).where(Customer.id == cus.id))
    m_stmt = delete(Meter).where(Meter.customer_id == customer_id)
    if not is_admin:
        m_stmt = m_stmt.where(
            or_(
                Meter.assigned_officer_id.in_(filter_ids),
                Meter.uploaded_by_officer_id.in_(filter_ids)
            )
        )
    await db.execute(m_stmt)
    await db.commit()
    await invalidate_customer_caches()
    return {"message": f"Customer '{customer_id}' deleted successfully"}

@router.post("/upload")
async def upload_customers_bulk(
    file: UploadFile = File(...),
    replace_all: bool = Query(False, description="Replace all previous customer records for this user"),
    mode: Optional[str] = Query("override", description="Import mode: 'override' (update existing & add new) or 'replace' (replace this officer's records)"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Bulk import customer records with user-specific isolation and overriding."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    officer_ctx = await get_or_create_officer_context(db, current_user)
    is_admin = (current_user.get("role") == "admin")

    result = await CustomerImportService.import_customers(
        file=file,
        db=db,
        uploader_officer_id=officer_ctx["officer_id"],
        user_id_str=officer_ctx["user_id"],
        replace_all=replace_all,
        uploader_officer_name=officer_ctx["officer_name"],
        is_admin=is_admin,
        mode=mode
    )
    await invalidate_customer_caches()
    return result

@router.delete("/clear-all")
@router.post("/clear-all")
async def clear_all_customers(
    all_officers: Optional[bool] = Query(False, description="Admin-only: clear records across all officers"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Clear customer records with user-scoped protection."""
    officer_ctx = await get_or_create_officer_context(db, current_user)
    is_admin = (current_user.get("role") == "admin")
    filter_ids = list(officer_ctx["filter_ids"])

    if is_admin and all_officers:
        await db.execute(delete(Meter))
        await db.execute(delete(Payment))
        await db.execute(delete(Assignment))
        await db.execute(delete(FieldVisit))
        await db.execute(delete(Customer))
        msg = "All system customer records cleared successfully."
    else:
        # User-specific clear: only affects this officer's records!
        officer_cus_cond = or_(
            Customer.uploaded_by_officer_id.in_(filter_ids),
            Customer.assigned_officer_id.in_(filter_ids)
        )
        officer_mtr_cond = or_(
            Meter.uploaded_by_officer_id.in_(filter_ids),
            Meter.assigned_officer_id.in_(filter_ids)
        )
        my_cids_res = await db.execute(select(Customer.customer_id).where(officer_cus_cond))
        my_cids = list(my_cids_res.scalars().all())

        if my_cids:
            await db.execute(delete(Meter).where(or_(officer_mtr_cond, Meter.customer_id.in_(my_cids))))
            await db.execute(delete(Payment).where(or_(Payment.officer_id.in_(filter_ids), Payment.customer_id.in_(my_cids))))
        else:
            await db.execute(delete(Meter).where(officer_mtr_cond))
            await db.execute(delete(Payment).where(Payment.officer_id.in_(filter_ids)))

        await db.execute(delete(Customer).where(officer_cus_cond))
        msg = f"All customer records assigned to {officer_ctx['officer_name']} ({officer_ctx['officer_id']}) cleared successfully."

    await db.commit()
    await invalidate_customer_caches()
    return {"success": True, "message": msg}
