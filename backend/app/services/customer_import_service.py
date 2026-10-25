import io
import csv
import math
import hashlib
import logging
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime, timezone, timedelta
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_, and_, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from fastapi import UploadFile, HTTPException

from app.models.customer import Customer
from app.models.meter import Meter
from app.models.payment import Payment
from app.models.audit import Assignment, FieldVisit
from app.database import point_wkt

logger = logging.getLogger("uvicorn.error")

class CustomerImportService:

    @staticmethod
    def normalize_header(header: str) -> str:
        """Clean and normalize column names for fuzzy header matching."""
        if not header:
            return ""
        return (
            header.strip()
            .lower()
            .replace('\t', ' ')
            .replace('\r', '')
            .replace('\n', '')
            .replace('_', ' ')
            .replace('-', ' ')
            .replace('.', ' ')
        ).strip()

    @staticmethod
    def get_column_mapping(headers: List[str]) -> Dict[str, int]:
        mapping: Dict[str, int] = {}
        normalized = [CustomerImportService.normalize_header(h) for h in headers]

        # Priority 1: Customer ID
        for idx, h in enumerate(normalized):
            if h in ['consumer no', 'consumer num', 'consumer number', 'consumer_no', 'customer id', 'customer_id', 'consumer id', 'ca no', 'account no', 'sc no', 'k no']:
                mapping['customer_id'] = idx
                break
        if 'customer_id' not in mapping:
            for idx, h in enumerate(normalized):
                if any(k in h for k in ['consumer no', 'consumer id', 'customer id', 'account no', 'ca no']):
                    mapping['customer_id'] = idx
                    break

        # Priority 2: Customer Name
        for idx, h in enumerate(normalized):
            if h in ['consumer name', 'customer name', 'cust name', 'client name', 'name', 'consumer']:
                mapping['name'] = idx
                break
        if 'name' not in mapping:
            for idx, h in enumerate(normalized):
                if any(k in h for k in ['consumer name', 'customer name', 'client name']) and 'incharge' not in h:
                    mapping['name'] = idx
                    break

        # Priority 3: Meter Number / ID
        for idx, h in enumerate(normalized):
            if h in ['meter number', 'meter id', 'meter no', 'meter_number', 'meter_id', 'mtr no', 'mtr id']:
                mapping['meter_number'] = idx
                break
        if 'meter_number' not in mapping:
            for idx, h in enumerate(normalized):
                if any(k in h for k in ['meter number', 'meter id', 'meter no']) and 'type' not in h and 'status' not in h and 'reading' not in h:
                    mapping['meter_number'] = idx
                    break

        # Priority 4: DTC Code (EXCLUDE incharge, section, name, remark, mobile)
        for idx, h in enumerate(normalized):
            if h in ['dtc code', 'dtc_code', 'dtc no', 'dtc_no', 'dtc number', 'dtc id', 'dtc']:
                mapping['dtc_code'] = idx
                break
        if 'dtc_code' not in mapping:
            for idx, h in enumerate(normalized):
                if ('dtc' in h or 'dtr' in h or 'transformer' in h) and not any(skip in h for skip in ['incharge', 'section', 'name', 'remark', 'mobile', 'phone', 'officer', 'tech']):
                    mapping['dtc_code'] = idx
                    break

        # Priority 5: Pending Amount (EXCLUDE SD, interest, opening, DPC, receipt, adjustment, cr, closing)
        for idx, h in enumerate(normalized):
            if h in ['pending amount', 'pending_amount', 'due amount', 'bill amount', 'net amount', 'total due amt']:
                mapping['pending_amount'] = idx
                break
        if 'pending_amount' not in mapping:
            for idx, h in enumerate(normalized):
                if any(k in h for k in ['pending amount', 'due amount', 'bill amount', 'arrears amount', 'total due']) and not any(skip in h for skip in ['sd', 'interest', 'opening', 'dpc', 'receipt', 'adjustment', 'cr', 'closing']):
                    mapping['pending_amount'] = idx
                    break
        if 'pending_amount' not in mapping:
            for idx, h in enumerate(normalized):
                if any(k in h for k in ['amount', 'amt', 'arrears']) and not any(skip in h for skip in ['sd', 'interest', 'opening', 'dpc', 'receipt', 'adjustment', 'cr', 'closing']):
                    mapping['pending_amount'] = idx
                    break

        # Priority 6: Latitude & Longitude
        for idx, h in enumerate(normalized):
            if h in ['latitude', 'lat']:
                mapping['latitude'] = idx
            elif h in ['longitude', 'long', 'lng', 'longitute']:
                mapping['longitude'] = idx
            elif h in ['lang long', 'lat long', 'coordinates', 'gps', 'lat/long']:
                mapping['lang_long'] = idx

        # Priority 7: Pending Days
        for idx, h in enumerate(normalized):
            if h in ['days pending', 'pending days', 'age in days', 'overdue days', 'due days']:
                mapping['pending_days'] = idx
                break
        if 'pending_days' not in mapping:
            for idx, h in enumerate(normalized):
                if any(k in h for k in ['days pending', 'pending days', 'age in days', 'overdue days', 'aging', 'ageing', 'no of days', 'os days']):
                    mapping['pending_days'] = idx
                    break

        # Priority 8: Address & Area
        for idx, h in enumerate(normalized):
            if 'address' in h:
                mapping['address'] = idx
            elif h in ['area', 'village', 'subdivision', 'division', 'ward', 'zone', 'city', 'section']:
                mapping['area'] = idx

        # Priority 9: Due Date
        for idx, h in enumerate(normalized):
            if any(k in h for k in ['due date', 'due_date', 'bill due date', 'prompt date']):
                mapping['due_date'] = idx
                break

        # Priority 10: Disconnection Status / Meter Action Status
        for idx, h in enumerate(normalized):
            if any(k == h for k in [
                'disconnection_status', 'disconnection status', 'disconn_status', 'disconn status',
                'disc_status', 'disc status', 'disconnection', 'disconn', 'meter_status', 'meter status',
                'status_code', 'status code', 'category', 'action', 'action_type', 'action status',
                'conn_status', 'connection_status', 'connection status', 'rc_dc', 'rc/dc', 'dc_status',
                'supply_status', 'supply status', 'status', 'consumer_status', 'remark', 'remarks', 'sub_status'
            ]):
                if not any(skip in h for skip in ['incharge', 'section', 'bill_status', 'payment_status', 'officer']):
                    mapping['disconnection_status'] = idx
                    break
        if 'disconnection_status' not in mapping:
            for idx, h in enumerate(normalized):
                if any(k in h for k in ['disconn', 'disc', 'status', 'action', 'category', 'rc_dc', 'rc/dc', 'remark']):
                    if not any(skip in h for skip in ['incharge', 'section', 'bill', 'payment', 'pay', 'officer', 'name', 'phone']):
                        mapping['disconnection_status'] = idx
                        break

        # Fallback if customer_id not found
        if 'customer_id' not in mapping and len(headers) > 0:
            mapping['customer_id'] = 0

        return mapping

    @staticmethod
    def normalize_dtc_code(val: Any) -> str:
        if val is None:
            return "0101001"
        s = str(val).strip()
        if not s or s.lower() in ('nan', 'none', 'null', '0', '0.0', '-'):
            return "0101001"
        # If string contains separator like "4364002 - DEVI MANDIR", extract leading code
        if ' - ' in s:
            s = s.split(' - ')[0].strip()
        elif '-' in s and not s.startswith('-'):
            parts = s.split('-')
            if parts[0].strip():
                s = parts[0].strip()
        if s.endswith('.0'):
            s = s[:-2]
        s = s.upper().replace(" ", "")
        import re
        clean_s = re.sub(r'[^A-Z0-9]', '', s)
        if clean_s:
            s = clean_s
        if len(s) > 50:
            s = s[:50]
        return s or "0101001"

    @staticmethod
    async def parse_file_rows(file: UploadFile) -> Tuple[List[str], List[List[Any]]]:
        content = await file.read()
        filename = (file.filename or '').lower()

        if filename.endswith('.csv'):
            try:
                text_content = content.decode('utf-8-sig', errors='ignore')
            except Exception:
                text_content = content.decode('latin-1', errors='ignore')
            
            stream = io.StringIO(text_content)
            reader = csv.reader(stream)
            rows = [row for row in reader if any(cell.strip() for cell in row)]
            if not rows:
                raise HTTPException(status_code=400, detail="Uploaded CSV file is empty.")
            headers = [str(cell) for cell in rows[0]]
            data_rows = rows[1:]
            return headers, data_rows

        elif filename.endswith('.xlsx') or filename.endswith('.xls'):
            try:
                import openpyxl
            except ImportError:
                raise HTTPException(status_code=500, detail="openpyxl package is required for Excel files.")

            try:
                workbook = openpyxl.load_workbook(filename=io.BytesIO(content), data_only=True)
            except Exception as e:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Failed to read Excel file. Please ensure it is a valid .xlsx file: {str(e)}"
                )

            sheet = workbook.active
            if sheet is None and workbook.worksheets:
                sheet = workbook.worksheets[0]

            if sheet is None:
                raise HTTPException(status_code=400, detail="Uploaded Excel file contains no valid or active worksheets.")

            rows = list(sheet.iter_rows(values_only=True))
            if not rows:
                raise HTTPException(status_code=400, detail="Uploaded Excel file is empty.")
            
            headers = [str(cell) if cell is not None else "" for cell in rows[0]]
            data_rows = [
                [cell if cell is not None else "" for cell in row]
                for row in rows[1:]
                if any(cell is not None and str(cell).strip() != "" for cell in row)
            ]
            return headers, data_rows

        else:
            raise HTTPException(status_code=400, detail="Unsupported file format. Please upload a .csv or .xlsx file.")

    @staticmethod
    async def import_customers(
        file: UploadFile, 
        db: AsyncSession, 
        uploader_officer_id: Optional[str] = None,
        user_id_str: Optional[str] = None,
        replace_all: bool = True,
        uploader_officer_name: Optional[str] = None,
        is_admin: bool = False
    ) -> Dict[str, Any]:
        """Process rows and bulk upsert records into PostgreSQL using PostGIS."""
        headers, data_rows = await CustomerImportService.parse_file_rows(file)
        mapping = CustomerImportService.get_column_mapping(headers)

        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        today = datetime.now(timezone.utc)
        default_due_date = (today + timedelta(days=15)).strftime("%Y-%m-%d")

        customers_to_upsert: Dict[str, Dict[str, Any]] = {}
        meters_to_upsert: List[Dict[str, Any]] = []
        errors = []

        base_lat = 21.1458
        base_lng = 79.0882

        for row_idx, row in enumerate(data_rows, start=2):
            try:
                def get_val(key: str, default: str = "") -> str:
                    if key in mapping and mapping[key] < len(row):
                        val = row[mapping[key]]
                        return str(val).strip() if val is not None else default
                    return default

                customer_id = get_val('customer_id')
                if not customer_id or customer_id.lower() in ('none', 'nan', 'null', ''):
                    customer_id = f"CUS{10000 + row_idx}"
                # Remove trailing .0 from customer_id if formatted as float
                if customer_id.endswith('.0') and customer_id[:-2].isdigit():
                    customer_id = customer_id[:-2]

                name = get_val('name') or f"Consumer {customer_id}"
                meter_number = get_val('meter_number') or f"MTR-{customer_id}"
                if meter_number.endswith('.0') and meter_number[:-2].isdigit():
                    meter_number = meter_number[:-2]

                # Coordinates with fallback
                lat = None
                lng = None

                if 'latitude' in mapping and 'longitude' in mapping:
                    try:
                        raw_lat_str = get_val('latitude', '')
                        raw_lng_str = get_val('longitude', '')
                        if raw_lat_str and raw_lng_str:
                            raw_lat = float(raw_lat_str)
                            raw_lng = float(raw_lng_str)
                            if -90 <= raw_lat <= 90 and -180 <= raw_lng <= 180 and (raw_lat != 0.0 or raw_lng != 0.0):
                                lat = raw_lat
                                lng = raw_lng
                    except (ValueError, TypeError):
                        pass
                elif 'lang_long' in mapping:
                    lang_long_str = get_val('lang_long')
                    delimiter = ',' if ',' in lang_long_str else (' ' if ' ' in lang_long_str else None)
                    if delimiter:
                        parts = lang_long_str.split(delimiter)
                        try:
                            raw_lat = float(parts[0].strip())
                            raw_lng = float(parts[1].strip())
                            if -90 <= raw_lat <= 90 and -180 <= raw_lng <= 180 and (raw_lat != 0.0 or raw_lng != 0.0):
                                lat = raw_lat
                                lng = raw_lng
                        except (ValueError, TypeError):
                            pass

                # Deterministic Nagpur GIS coordinates fallback if none or 0
                if lat is None or lng is None or (lat == 0.0 and lng == 0.0):
                    h = int(hashlib.md5(str(customer_id).encode()).hexdigest()[:8], 16)
                    angle = (h % 360) * (math.pi / 180.0)
                    dist = 0.008 + ((h >> 8) % 40) * 0.001
                    lat = round(base_lat + dist * math.cos(angle), 6)
                    lng = round(base_lng + dist * math.sin(angle), 6)

                # Pending Amount
                pending_amount = 0.0
                raw_amt = get_val('pending_amount', '0')
                clean_amt = raw_amt.replace('$', '').replace('₹', '').replace(',', '').strip()
                try:
                    pending_amount = round(float(clean_amt), 2)
                except (ValueError, TypeError):
                    pending_amount = 0.0

                area = get_val('area') or "Central Ward"
                address = get_val('address') or f"Plot {row_idx}, {area}"

                # DTC Code (clean & bounded)
                raw_dtc = get_val('dtc_code', '')
                dtc_code = CustomerImportService.normalize_dtc_code(raw_dtc)

                status = "overdue" if pending_amount > 3000 else ("pending" if pending_amount > 0 else "paid")
                priority = "high" if pending_amount > 5000 else "normal"

                raw_disconn = get_val('disconnection_status', '').upper().strip()
                disconn_status = 'NC'
                if any(k in raw_disconn for k in ['TEMPORARY', 'TEMP', 'TD', 'T.D.']):
                    disconn_status = 'TD'
                elif any(k in raw_disconn for k in ['PERMANENT', 'PERM', 'PD', 'P.D.']):
                    disconn_status = 'PD'
                elif any(k in raw_disconn for k in ['BURNT', 'BURN', 'BUR', 'DEFECTIVE', 'FAULTY']):
                    disconn_status = 'BUR'
                elif any(k in raw_disconn for k in ['DISPUT', 'COURT', 'LITIGATION', 'DIS', 'D.I.S.']):
                    disconn_status = 'DIS'
                elif any(k in raw_disconn for k in ['NORMAL', 'CONNECTED', 'LIVE', 'REGULAR', 'NC', 'N.C.', 'OTHER', 'OK']):
                    disconn_status = 'NC'

                officer_id_to_assign = uploader_officer_id or user_id_str or "OFF-1001"

                pending_days = None
                raw_pending_days = get_val('pending_days', '')
                if raw_pending_days:
                    try:
                        pending_days = str(int(float(str(raw_pending_days).strip())))
                    except (ValueError, TypeError):
                        pending_days = str(raw_pending_days).strip() or None

                raw_due_date = get_val('due_date', '')
                due_date = raw_due_date if raw_due_date else default_due_date

                # PostGIS Geometry
                pt_geom = point_wkt(lng, lat)

                customers_to_upsert[customer_id] = {
                    "id": str(uuid4()),
                    "customer_id": customer_id,
                    "name": name,
                    "phone": f"+91 98{row_idx % 90 + 10:02d}001122",
                    "email": f"customer_{customer_id.lower()}@example.com",
                    "address": address,
                    "area": area,
                    "latitude": lat,
                    "longitude": lng,
                    "location": pt_geom,
                    "meter_number": meter_number,
                    "dtc_code": dtc_code,
                    "pending_amount": pending_amount,
                    "due_date": due_date,
                    "pending_days": pending_days,
                    "status": status,
                    "disconnection_status": disconn_status,
                    "priority": priority,
                    "assigned_officer_id": officer_id_to_assign,
                    "assigned_officer_name": uploader_officer_name,
                    "uploaded_by_officer_id": uploader_officer_id or officer_id_to_assign,
                    "created_at": now_str,
                    "updated_at": now_str
                }

                meters_to_upsert.append({
                    "id": str(uuid4()),
                    "meter_id": f"MTR-{meter_number}",
                    "meter_number": meter_number,
                    "customer_id": customer_id,
                    "latitude": lat,
                    "longitude": lng,
                    "location": pt_geom,
                    "dtc_code": dtc_code,
                    "assigned_officer_id": officer_id_to_assign,
                    "assigned_officer_name": uploader_officer_name,
                    "uploaded_by_officer_id": uploader_officer_id or officer_id_to_assign,
                    "created_at": now_str,
                    "updated_at": now_str
                })

            except Exception as row_exc:
                errors.append(f"Row {row_idx}: {str(row_exc)}")

        if not customers_to_upsert:
            raise HTTPException(
                status_code=400,
                detail=f"Import failed: {errors[0] if errors else 'No valid rows found in file.'}"
            )

        # High-throughput Batch Upsert into PostgreSQL (chunks of 100)
        inserted_count = 0
        updated_count = 0
        deleted_count = 0
        CHUNK_SIZE = 100

        try:
            # Determine identifier(s) for the current officer
            officer_filter_ids = set()
            if uploader_officer_id:
                officer_filter_ids.add(str(uploader_officer_id))
            if user_id_str:
                officer_filter_ids.add(str(user_id_str))

            if not officer_filter_ids:
                raise HTTPException(
                    status_code=400,
                    detail="Upload rejected: Unable to identify the target officer account."
                )

            incoming_cust_ids = list(customers_to_upsert.keys())
            cus_list = list(customers_to_upsert.values())

            # Define user-scoped filters to ensure we NEVER delete or affect another officer's records
            filter_id_list = list(officer_filter_ids)
            officer_cus_cond = or_(
                Customer.uploaded_by_officer_id.in_(filter_id_list),
                Customer.assigned_officer_id.in_(filter_id_list)
            )
            officer_mtr_cond = or_(
                Meter.uploaded_by_officer_id.in_(filter_id_list),
                Meter.assigned_officer_id.in_(filter_id_list)
            )

            if replace_all:
                # Find only previous customer IDs uploaded by / assigned to THIS officer
                del_res = await db.execute(select(Customer.customer_id).where(officer_cus_cond))
                existing_user_cids = list(del_res.scalars().all())
                deleted_count = len(existing_user_cids)

                # Delete ALL previous records belonging to THIS officer:
                # 1. Collected Payments / Transactions
                if existing_user_cids:
                    await db.execute(
                        delete(Payment).where(
                            or_(
                                Payment.officer_id.in_(filter_id_list),
                                Payment.customer_id.in_(existing_user_cids)
                            )
                        )
                    )
                else:
                    await db.execute(delete(Payment).where(Payment.officer_id.in_(filter_id_list)))

                # 2. Field Visits
                if existing_user_cids:
                    await db.execute(
                        delete(FieldVisit).where(
                            or_(
                                FieldVisit.officer_id.in_(filter_id_list),
                                FieldVisit.customer_id.in_(existing_user_cids)
                            )
                        )
                    )
                else:
                    await db.execute(delete(FieldVisit).where(FieldVisit.officer_id.in_(filter_id_list)))

                # 3. Target Assignments
                await db.execute(delete(Assignment).where(Assignment.officer_id.in_(filter_id_list)))

                # 4. Meters linked to this officer's previous customers or tagged to this officer
                if existing_user_cids:
                    await db.execute(
                        delete(Meter).where(
                            or_(
                                Meter.customer_id.in_(existing_user_cids),
                                officer_mtr_cond
                            )
                        )
                    )
                else:
                    await db.execute(delete(Meter).where(officer_mtr_cond))

                # 5. Customers belonging to THIS officer
                await db.execute(delete(Customer).where(officer_cus_cond))

                inserted_count = len(cus_list)
                updated_count = 0
            else:
                # In append mode, calculate existing vs new for THIS officer
                existing_in_db = set()
                for i in range(0, len(incoming_cust_ids), 500):
                    id_sub = incoming_cust_ids[i : i + 500]
                    chk_res = await db.execute(
                        select(Customer.customer_id).where(
                            and_(
                                Customer.customer_id.in_(id_sub),
                                officer_cus_cond
                            )
                        )
                    )
                    for row in chk_res.scalars().all():
                        existing_in_db.add(row)

                updated_count = len(existing_in_db)
                inserted_count = len(cus_list) - updated_count
                deleted_count = 0

            # Batch upsert Customer records
            for i in range(0, len(cus_list), CHUNK_SIZE):
                chunk = cus_list[i : i + CHUNK_SIZE]
                stmt = pg_insert(Customer).values(chunk)
                update_cols = {
                    c.name: stmt.excluded[c.name]
                    for c in Customer.__table__.columns
                    if c.name not in ('id', 'customer_id', 'created_at')
                }
                stmt = stmt.on_conflict_do_update(
                    index_elements=['customer_id'],
                    set_=update_cols
                )
                await db.execute(stmt)

            # Sync meters for uploaded customers (clean up meter duplicates for the incoming customer IDs for this officer)
            for i in range(0, len(meters_to_upsert), CHUNK_SIZE):
                m_chunk = meters_to_upsert[i : i + CHUNK_SIZE]
                cust_ids = [m['customer_id'] for m in m_chunk]
                await db.execute(
                    delete(Meter).where(
                        and_(
                            Meter.customer_id.in_(cust_ids),
                            officer_mtr_cond
                        )
                    )
                )
                await db.execute(pg_insert(Meter).values(m_chunk))

            await db.commit()

        except Exception as db_exc:
            await db.rollback()
            logger.error(f"PostgreSQL batch import error: {db_exc}", exc_info=True)
            raise HTTPException(
                status_code=400,
                detail=f"Database import error: {str(db_exc)}"
            )

        return {
            "success": True,
            "filename": file.filename,
            "total_processed": len(data_rows),
            "inserted_count": inserted_count,
            "updated_count": updated_count,
            "deleted_count": deleted_count,
            "errors": errors[:10]
        }
