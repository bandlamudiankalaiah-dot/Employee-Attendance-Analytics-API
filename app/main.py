import os
import calendar
from datetime import datetime, date, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional, Dict, Any, Union
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Path, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator, StrictInt, EmailStr
from pymongo import MongoClient, ASCENDING, DESCENDING, ReturnDocument
from pymongo.collection import Collection
from pymongo.errors import DuplicateKeyError, PyMongoError, OperationFailure

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "attendance_db")

# Timezone setup: IST is UTC+05:30
IST_OFFSET = timedelta(hours=5, minutes=30)
IST_TZ = timezone(IST_OFFSET)

client: Optional[MongoClient] = None
db = None
is_db_ready: bool = False
db_init_error: Optional[str] = None

def get_db():
    global client, db
    if db is None:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000, tz_aware=True)
        db = client[MONGO_DB]
    return db

def init_db_indexes(database):
    """Idempotently create all required database indexes on application startup."""
    index_specs = [
        (database.employees, [("emp_code", ASCENDING)], {"unique": True, "name": "idx_emp_code_unique"}),
        (database.employees, [("department", ASCENDING), ("emp_code", ASCENDING)], {"name": "idx_dept_emp_code"}),
        (database.attendance_logs, [("emp_code", ASCENDING), ("date", ASCENDING)], {"unique": True, "name": "idx_emp_code_date_unique"}),
        (database.attendance_logs, [("date", DESCENDING), ("status", ASCENDING)], {"name": "idx_date_desc_status"}),
        (database.attendance_logs, [("emp_code", ASCENDING), ("date", DESCENDING)], {"name": "idx_emp_code_date_desc"}),
    ]
    for coll, keys, kwargs in index_specs:
        try:
            coll.create_index(keys, **kwargs)
        except Exception as e:
            if "IndexOptionsConflict" in str(e) or "already exists with a different name" in str(e):
                pass
            else:
                raise e

@asynccontextmanager
async def lifespan(app: FastAPI):
    global is_db_ready, db_init_error, client, db
    try:
        database = get_db()
        client.admin.command('ping')
        init_db_indexes(database)
        is_db_ready = True
        db_init_error = None
        print("MongoDB connection verified and indexes initialized successfully.")
    except Exception as e:
        is_db_ready = False
        db_init_error = str(e)
        print(f"CRITICAL: Application startup MongoDB initialization failed: {e}")
    yield
    if client:
        try:
            client.close()
            print("MongoDB client connection closed cleanly.")
        except Exception:
            pass

app = FastAPI(
    title="Employee Attendance & Analytics API",
    version="1.0.0",
    description="Production-grade Backend API for Employee Attendance Management and Analytics.",
    lifespan=lifespan
)

# CORS configuration: explicit origins, avoiding wildcard with credentials
CORS_ORIGINS_RAW = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8000")
ALLOWED_ORIGINS = [orig.strip() for orig in CORS_ORIGINS_RAW.split(",") if orig.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# Date & Timestamp Validation Helpers
# ---------------------------------------------------------

def validate_calendar_date(d_str: Optional[str], param_name: str = "date") -> Optional[date]:
    """Validates real calendar existence of YYYY-MM-DD date. Rejects impossible dates like 2024-02-31."""
    if d_str is None:
        return None
    try:
        parts = d_str.split("-")
        if len(parts) != 3 or len(parts[0]) != 4 or len(parts[1]) != 2 or len(parts[2]) != 2:
            raise ValueError
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        return date(y, m, d)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid calendar date for '{param_name}': '{d_str}'. Must be a valid existing date in YYYY-MM-DD format."
        )

def validate_month_str(m_str: str, param_name: str = "month") -> tuple[int, int, int]:
    """Validates YYYY-MM month format and returns (year, month, num_days_in_month)."""
    try:
        parts = m_str.split("-")
        if len(parts) != 2 or len(parts[0]) != 4 or len(parts[1]) != 2:
            raise ValueError
        y, m = int(parts[0]), int(parts[1])
        if not (1 <= m <= 12):
            raise ValueError
        num_days = calendar.monthrange(y, m)[1]
        return y, m, num_days
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid month format for '{param_name}': '{m_str}'. Must be YYYY-MM."
        )

def dt_to_epoch_ms(dt: Optional[datetime]) -> Optional[int]:
    """Convert datetime to integer epoch milliseconds truncated to whole seconds."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    sec = int(dt.timestamp())
    return sec * 1000

def epoch_ms_to_utc_dt(epoch_ms: int) -> datetime:
    """Convert integer epoch milliseconds to UTC datetime, truncated to whole second."""
    whole_seconds = epoch_ms // 1000
    return datetime.fromtimestamp(whole_seconds, tz=timezone.utc)

def round_half_up(val: Union[float, Decimal], places: int = 2) -> float:
    """Contractual Decimal ROUND_HALF_UP rounding."""
    d = Decimal(str(val))
    q = Decimal("10") ** -places
    return float(d.quantize(q, rounding=ROUND_HALF_UP))

def parse_time_str(t_str: str) -> time:
    parts = t_str.split(":")
    h, m = int(parts[0]), int(parts[1])
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError("Invalid time string.")
    return time(h, m)

def determine_shift_date_and_times(punch_in_utc: datetime, shift_start_str: str, shift_end_str: str):
    """
    R1: Convert punch_in to IST.
    If overnight shift (shift_end <= shift_start):
      If punch_in time in IST is strictly < shift_end,
      the attendance belongs to the previous calendar day's shift!
    """
    if punch_in_utc.tzinfo is None:
        punch_in_utc = punch_in_utc.replace(tzinfo=timezone.utc)
    punch_in_ist = punch_in_utc.astimezone(IST_TZ)
    calendar_date = punch_in_ist.date()
    punch_time = punch_in_ist.time()
    
    start_time = parse_time_str(shift_start_str)
    end_time = parse_time_str(shift_end_str)
    
    is_overnight = (end_time.hour * 60 + end_time.minute) <= (start_time.hour * 60 + start_time.minute)
    
    if is_overnight and punch_time < end_time:
        shift_date = calendar_date - timedelta(days=1)
    else:
        shift_date = calendar_date
        
    # Scheduled start in UTC
    sched_start_ist = datetime.combine(shift_date, start_time, tzinfo=IST_TZ)
    sched_start_utc = sched_start_ist.astimezone(timezone.utc)
    
    # Scheduled end in UTC
    end_date_offset = timedelta(days=1) if is_overnight else timedelta(days=0)
    sched_end_ist = datetime.combine(shift_date + end_date_offset, end_time, tzinfo=IST_TZ)
    sched_end_utc = sched_end_ist.astimezone(timezone.utc)
    
    return shift_date.isoformat(), sched_start_utc, sched_end_utc

def calculate_late_minutes(punch_in_utc: datetime, scheduled_start_utc: datetime) -> int:
    """
    R2: Late minutes:
    - Grace period: 10 minutes (600 seconds).
    - Late only when strictly > 10 minutes after shift start.
    - If late, calculate whole elapsed minutes from shift start.
    """
    if punch_in_utc.tzinfo is None:
        punch_in_utc = punch_in_utc.replace(tzinfo=timezone.utc)
    if scheduled_start_utc.tzinfo is None:
        scheduled_start_utc = scheduled_start_utc.replace(tzinfo=timezone.utc)
    diff_sec = (punch_in_utc - scheduled_start_utc).total_seconds()
    if diff_sec > 600:
        return int(diff_sec // 60)
    return 0

def calculate_work_and_overtime(punch_in_utc: datetime, punch_out_utc: datetime, scheduled_end_utc: datetime):
    """
    R3: Overtime >= 30 minutes after scheduled shift end.
    R4: Work hours in hours, Decimal half-up to 2 places.
    R5: Half day = work_hours < 4.50.
    """
    if punch_in_utc.tzinfo is None:
        punch_in_utc = punch_in_utc.replace(tzinfo=timezone.utc)
    if punch_out_utc.tzinfo is None:
        punch_out_utc = punch_out_utc.replace(tzinfo=timezone.utc)
    if scheduled_end_utc.tzinfo is None:
        scheduled_end_utc = scheduled_end_utc.replace(tzinfo=timezone.utc)
        
    duration_sec = (punch_out_utc - punch_in_utc).total_seconds()
    if duration_sec < 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Punch-out timestamp cannot be earlier than punch-in.")
        
    hours_dec = Decimal(str(duration_sec)) / Decimal("3600")
    work_hours = float(hours_dec.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    
    # Overtime
    ot_sec = (punch_out_utc - scheduled_end_utc).total_seconds()
    if ot_sec >= 1800:
        overtime_minutes = int(ot_sec // 60)
    else:
        overtime_minutes = 0
        
    half_day = work_hours < 4.50
    return work_hours, overtime_minutes, half_day

def format_attendance_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Transforms raw MongoDB attendance document to API response shape."""
    history_formatted = []
    for h in doc.get("history", []):
        history_formatted.append({
            "at": dt_to_epoch_ms(h.get("at")) if isinstance(h.get("at"), datetime) else h.get("at"),
            "by": h.get("by"),
            "reason": h.get("reason"),
            "changes": h.get("changes", {})
        })
        
    return {
        "emp_code": doc["emp_code"],
        "date": doc["date"],
        "status": doc.get("status", "PRESENT"),
        "punch_in": dt_to_epoch_ms(doc.get("punch_in")),
        "punch_out": dt_to_epoch_ms(doc.get("punch_out")),
        "late_minutes": doc.get("late_minutes", 0),
        "work_hours": doc.get("work_hours"),
        "overtime_minutes": doc.get("overtime_minutes", 0),
        "half_day": doc.get("half_day", False),
        "history": history_formatted
    }

# ---------------------------------------------------------
# Request & Response Schemas
# ---------------------------------------------------------

class EmployeeCreate(BaseModel):
    emp_code: str = Field(..., min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr = Field(...)
    department: str = Field(..., min_length=1, max_length=100)
    shift_start: str = Field(..., pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    shift_end: str = Field(..., pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    joined_on: str = Field(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")

    @model_validator(mode="after")
    def validate_employee_fields(self):
        if self.shift_start == self.shift_end:
            raise ValueError("shift_start and shift_end cannot be identical.")
        y, m, d = map(int, self.joined_on.split("-"))
        try:
            date(y, m, d)
        except ValueError:
            raise ValueError("joined_on is an invalid calendar date.")
        return self

class PunchInRequest(BaseModel):
    emp_code: str = Field(..., min_length=1)
    punched_at: Optional[Any] = Field(None, description="Epoch milliseconds (integer)")
    status: Optional[str] = Field("PRESENT", pattern=r"^(PRESENT|WFH|ON_DUTY)$")

    @field_validator("punched_at")
    @classmethod
    def validate_strict_epoch_ms(cls, v):
        if v is not None:
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValueError("punched_at must be an integer epoch millisecond timestamp.")
            if v < 946684800000 or v > 32503680000000:
                raise ValueError("Invalid punched_at epoch millisecond timestamp.")
        return v

class PunchOutRequest(BaseModel):
    emp_code: str = Field(..., min_length=1)
    punched_at: Optional[Any] = Field(None, description="Epoch milliseconds (integer)")

    @field_validator("punched_at")
    @classmethod
    def validate_strict_epoch_ms(cls, v):
        if v is not None:
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValueError("punched_at must be an integer epoch millisecond timestamp.")
            if v < 946684800000 or v > 32503680000000:
                raise ValueError("Invalid punched_at epoch millisecond timestamp.")
        return v

class RegularizationRequest(BaseModel):
    regularized_by: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=1)
    status: Optional[str] = Field(None, pattern=r"^(PRESENT|WFH|ON_DUTY|ABSENT|LEAVE)$")
    punch_in: Optional[Any] = Field(None, description="Epoch milliseconds")
    punch_out: Optional[Any] = Field(None, description="Epoch milliseconds")

    @field_validator("punch_in", "punch_out")
    @classmethod
    def validate_strict_epoch_ms(cls, v):
        if v is not None:
            if isinstance(v, bool) or not isinstance(v, int):
                raise ValueError("Timestamp must be an integer epoch millisecond timestamp.")
            if v < 946684800000 or v > 32503680000000:
                raise ValueError("Invalid epoch millisecond timestamp.")
        return v

# ---------------------------------------------------------
# Health Check Endpoint
# ---------------------------------------------------------

@app.get("/health", tags=["System"])
def health_check():
    """Verifies service readiness and database connectivity."""
    if not is_db_ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database service is not ready: {db_init_error or 'initialization failed or database disconnected.'}"
        )
    database = get_db()
    try:
        client.admin.command('ping')
        return {
            "status": "ok",
            "mongo_connected": True,
            "db_name": database.name
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connection error: {str(e)}"
        )

# ---------------------------------------------------------
# Phase 3: Employee Management
# ---------------------------------------------------------

@app.post("/employees", status_code=status.HTTP_201_CREATED, tags=["Employees"])
def create_employee(emp: EmployeeCreate):
    database = get_db()
    now_utc = datetime.now(timezone.utc)
    doc = emp.model_dump()
    doc["created_at"] = now_utc
    
    try:
        database.employees.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Employee code '{emp.emp_code}' already exists."
        )
    except PyMongoError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
        
    created_doc = database.employees.find_one({"emp_code": emp.emp_code}, {"_id": 0})
    if created_doc and isinstance(created_doc.get("created_at"), datetime):
        created_doc["created_at"] = created_doc["created_at"].isoformat()
    return created_doc

@app.get("/employees", tags=["Employees"])
def list_employees(
    department: Optional[str] = Query(None, description="Exact case-sensitive department filter"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100)
):
    database = get_db()
    query_filter: Dict[str, Any] = {}
    if department is not None:
        query_filter["department"] = department
        
    total = database.employees.count_documents(query_filter)
    skip = (page - 1) * page_size
    
    cursor = database.employees.find(query_filter, {"_id": 0})\
        .sort("emp_code", ASCENDING)\
        .skip(skip)\
        .limit(page_size)
        
    items = []
    for doc in cursor:
        if isinstance(doc.get("created_at"), datetime):
            doc["created_at"] = doc["created_at"].isoformat()
        items.append(doc)
        
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages
    }

# ---------------------------------------------------------
# Phase 4 & 5: Attendance Punch-in & Punch-out
# ---------------------------------------------------------

@app.post("/attendance/punch-in", status_code=status.HTTP_201_CREATED, tags=["Attendance"])
def punch_in(body: PunchInRequest):
    database = get_db()
    emp = database.employees.find_one({"emp_code": body.emp_code})
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee '{body.emp_code}' not found.")
        
    if body.punched_at is not None:
        punch_in_utc = epoch_ms_to_utc_dt(body.punched_at)
    else:
        now = datetime.now(timezone.utc)
        punch_in_utc = now.replace(microsecond=0)
        
    shift_date, sched_start_utc, _ = determine_shift_date_and_times(
        punch_in_utc, emp["shift_start"], emp["shift_end"]
    )
    
    late_minutes = calculate_late_minutes(punch_in_utc, sched_start_utc)
    
    new_record = {
        "emp_code": body.emp_code,
        "date": shift_date,
        "status": body.status or "PRESENT",
        "punch_in": punch_in_utc,
        "punch_out": None,
        "late_minutes": late_minutes,
        "work_hours": None,
        "overtime_minutes": 0,
        "half_day": False,
        "history": [],
        "version": 1
    }
    
    try:
        database.attendance_logs.insert_one(new_record)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Attendance record already exists for {body.emp_code} on shift date {shift_date}."
        )
        
    saved = database.attendance_logs.find_one({"emp_code": body.emp_code, "date": shift_date})
    return format_attendance_doc(saved)

@app.post("/attendance/punch-out", tags=["Attendance"])
def punch_out(body: PunchOutRequest):
    database = get_db()
    emp = database.employees.find_one({"emp_code": body.emp_code})
    if not emp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee '{body.emp_code}' not found."
        )
        
    if body.punched_at is not None:
        punch_out_utc = epoch_ms_to_utc_dt(body.punched_at)
    else:
        now = datetime.now(timezone.utc)
        punch_out_utc = now.replace(microsecond=0)
        
    # Determine the target shift date and scheduled times based on punch_out instant
    target_shift_date, _, _ = determine_shift_date_and_times(
        punch_out_utc, emp["shift_start"], emp["shift_end"]
    )
    
    # Look for the attendance record corresponding to target shift date
    active_record = database.attendance_logs.find_one({
        "emp_code": body.emp_code,
        "date": target_shift_date
    })
    
    # If not found directly, check if this is an overnight shift that began yesterday
    if not active_record:
        start_time = parse_time_str(emp["shift_start"])
        end_time = parse_time_str(emp["shift_end"])
        is_overnight = (end_time.hour * 60 + end_time.minute) <= (start_time.hour * 60 + start_time.minute)
        if is_overnight:
            prev_date_str = (date.fromisoformat(target_shift_date) - timedelta(days=1)).isoformat()
            prev_record = database.attendance_logs.find_one({
                "emp_code": body.emp_code,
                "date": prev_date_str
            })
            if prev_record:
                active_record = prev_record
                target_shift_date = prev_date_str
                
    if not active_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active punch-in found for employee '{body.emp_code}' on shift date {target_shift_date}."
        )
        
    if active_record.get("punch_out") is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Attendance already has a punch-out recorded."
        )
        
    punch_in_utc = active_record["punch_in"]
    if punch_in_utc.tzinfo is None:
        punch_in_utc = punch_in_utc.replace(tzinfo=timezone.utc)
        
    if punch_out_utc < punch_in_utc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Punch-out timestamp cannot be earlier than punch-in."
        )
        
    # Re-calculate scheduled end based on the actual punch_in shift date
    _, _, actual_sched_end_utc = determine_shift_date_and_times(
        punch_in_utc, emp["shift_start"], emp["shift_end"]
    )
    
    work_hours, overtime_minutes, half_day = calculate_work_and_overtime(
        punch_in_utc, punch_out_utc, actual_sched_end_utc
    )
    
    # Atomic update on specific record with punch_out: None to prevent race conditions
    updated_doc = database.attendance_logs.find_one_and_update(
        {
            "_id": active_record["_id"],
            "punch_out": None
        },
        {
            "$set": {
                "punch_out": punch_out_utc,
                "work_hours": work_hours,
                "overtime_minutes": overtime_minutes,
                "half_day": half_day
            }
        },
        return_document=ReturnDocument.AFTER
    )
    
    if not updated_doc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Concurrent punch-out detected or attendance record was already punched out."
        )
        
    return format_attendance_doc(updated_doc)

# ---------------------------------------------------------
# Phase 6: Attendance Listing
# ---------------------------------------------------------

@app.get("/attendance", tags=["Attendance"])
def list_attendance(
    emp_code: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status", pattern=r"^(PRESENT|WFH|ON_DUTY|ABSENT|LEAVE)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100)
):
    database = get_db()
    
    # Real calendar date validation
    d_from = validate_calendar_date(date_from, "date_from")
    d_to = validate_calendar_date(date_to, "date_to")
    
    if d_from and d_to and d_from > d_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date_from cannot be later than date_to."
        )
        
    query_filter: Dict[str, Any] = {}
    
    if emp_code:
        query_filter["emp_code"] = emp_code
    if status_filter:
        query_filter["status"] = status_filter
        
    if date_from or date_to:
        date_q = {}
        if date_from:
            date_q["$gte"] = date_from
        if date_to:
            date_q["$lte"] = date_to
        query_filter["date"] = date_q
        
    total = database.attendance_logs.count_documents(query_filter)
    skip = (page - 1) * page_size
    
    cursor = database.attendance_logs.find(query_filter, {"_id": 0})\
        .sort("date", DESCENDING)\
        .skip(skip)\
        .limit(page_size)
        
    items = [format_attendance_doc(doc) for doc in cursor]
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0
    
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages
    }

# ---------------------------------------------------------
# Phase 7: Attendance Regularization
# ---------------------------------------------------------

@app.patch("/attendance/{emp_code}/{shift_date}", tags=["Attendance"])
def regularize_attendance(
    emp_code: str = Path(...),
    shift_date: str = Path(...),
    body: RegularizationRequest = ...
):
    validate_calendar_date(shift_date, "shift_date")
    database = get_db()
    emp = database.employees.find_one({"emp_code": emp_code})
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee '{emp_code}' not found.")
        
    existing = database.attendance_logs.find_one({"emp_code": emp_code, "date": shift_date})
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Attendance record not found for {emp_code} on {shift_date}.")
        
    changes = {}
    new_punch_in = existing.get("punch_in")
    new_punch_out = existing.get("punch_out")
    new_status = existing.get("status")
    
    if body.status is not None and body.status != existing.get("status"):
        changes["status"] = {"old": existing.get("status"), "new": body.status}
        new_status = body.status
        
    if body.punch_in is not None:
        proposed_in_dt = epoch_ms_to_utc_dt(body.punch_in)
        old_in_ms = dt_to_epoch_ms(existing.get("punch_in"))
        if dt_to_epoch_ms(proposed_in_dt) != old_in_ms:
            changes["punch_in"] = {"old": old_in_ms, "new": dt_to_epoch_ms(proposed_in_dt)}
            new_punch_in = proposed_in_dt
            
    if body.punch_out is not None:
        proposed_out_dt = epoch_ms_to_utc_dt(body.punch_out)
        old_out_ms = dt_to_epoch_ms(existing.get("punch_out"))
        if dt_to_epoch_ms(proposed_out_dt) != old_out_ms:
            changes["punch_out"] = {"old": old_out_ms, "new": dt_to_epoch_ms(proposed_out_dt)}
            new_punch_out = proposed_out_dt
            
    if not changes:
        # No-op: do not append to history
        return format_attendance_doc(existing)
        
    # Validate chronological consistency
    if new_punch_in and new_punch_out:
        pin = new_punch_in.replace(tzinfo=timezone.utc) if new_punch_in.tzinfo is None else new_punch_in
        pout = new_punch_out.replace(tzinfo=timezone.utc) if new_punch_out.tzinfo is None else new_punch_out
        if pout < pin:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Punch-out timestamp cannot be earlier than punch-in."
            )
            
    # Recompute derived metrics
    _, sched_start_utc, sched_end_utc = determine_shift_date_and_times(
        new_punch_in if new_punch_in else datetime.now(timezone.utc),
        emp["shift_start"], emp["shift_end"]
    )
    
    new_late_minutes = existing.get("late_minutes", 0)
    new_work_hours = existing.get("work_hours")
    new_overtime_minutes = existing.get("overtime_minutes", 0)
    new_half_day = existing.get("half_day", False)
    
    if new_punch_in:
        new_late_minutes = calculate_late_minutes(new_punch_in, sched_start_utc)
        
    if new_punch_in and new_punch_out:
        new_work_hours, new_overtime_minutes, new_half_day = calculate_work_and_overtime(
            new_punch_in, new_punch_out, sched_end_utc
        )
    elif not new_punch_out:
        new_work_hours = None
        new_overtime_minutes = 0
        new_half_day = False
        
    history_entry = {
        "at": datetime.now(timezone.utc),
        "by": body.regularized_by,
        "reason": body.reason,
        "changes": changes
    }
    
    current_version = existing.get("version", 1)
    
    updated = database.attendance_logs.find_one_and_update(
        {
            "_id": existing["_id"],
            "version": current_version
        },
        {
            "$set": {
                "status": new_status,
                "punch_in": new_punch_in,
                "punch_out": new_punch_out,
                "late_minutes": new_late_minutes,
                "work_hours": new_work_hours,
                "overtime_minutes": new_overtime_minutes,
                "half_day": new_half_day,
                "version": current_version + 1
            },
            "$push": {
                "history": history_entry
            }
        },
        return_document=ReturnDocument.AFTER
    )
    
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflict: Attendance record was modified concurrently by another transaction."
        )
        
    return format_attendance_doc(updated)

# ---------------------------------------------------------
# Phase 8: Monthly Employee Analytics
# ---------------------------------------------------------

@app.get("/analytics/employees/{emp_code}/monthly", tags=["Analytics"])
def employee_monthly_analytics(
    emp_code: str = Path(...),
    month: str = Query(...)
):
    year, month_num, num_days = validate_month_str(month, "month")
    database = get_db()
    emp = database.employees.find_one({"emp_code": emp_code})
    if not emp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Employee '{emp_code}' not found.")
        
    month_start_date = date(year, month_num, 1)
    month_end_date = date(year, month_num, num_days)
    
    joined_date = date.fromisoformat(emp["joined_on"])
    effective_start = max(month_start_date, joined_date)
    
    total_working_days = 0
    if effective_start <= month_end_date:
        cur = effective_start
        while cur <= month_end_date:
            if cur.weekday() < 5:  # Monday to Friday
                total_working_days += 1
            cur += timedelta(days=1)
            
    query = {
        "emp_code": emp_code,
        "date": {
            "$gte": f"{month}-01",
            "$lte": f"{month}-{num_days:02d}"
        }
    }
    logs = list(database.attendance_logs.find(query))
    
    present_days = 0.0
    half_days_count = 0
    total_late_minutes = 0
    total_overtime_minutes = 0
    
    presence_statuses = {"PRESENT", "WFH", "ON_DUTY"}
    
    for l in logs:
        l_date = date.fromisoformat(l["date"])
        is_weekday = l_date.weekday() < 5
        st = l.get("status", "PRESENT")
        is_present = st in presence_statuses
        is_half_day = l.get("half_day", False)
        
        if is_half_day:
            half_days_count += 1
            
        if is_weekday and is_present:
            if is_half_day:
                present_days += 0.5
            else:
                present_days += 1.0
                
        # Late minutes and overtime include weekends
        total_late_minutes += int(l.get("late_minutes", 0) or 0)
        total_overtime_minutes += int(l.get("overtime_minutes", 0) or 0)
        
    attendance_rate = 0.0
    if total_working_days > 0:
        rate_val = (Decimal(str(present_days)) / Decimal(str(total_working_days))) * Decimal("100")
        attendance_rate = round_half_up(rate_val, 2)
        
    absent_days = max(0, int(total_working_days - present_days))
    
    return {
        "emp_code": emp_code,
        "month": month,
        "total_working_days": total_working_days,
        "present_days": present_days,
        "absent_days": absent_days,
        "half_days": half_days_count,
        "attendance_rate": attendance_rate,
        "total_late_minutes": total_late_minutes,
        "total_overtime_minutes": total_overtime_minutes
    }

# ---------------------------------------------------------
# Phase 9: Department Monthly Summary (Database-Side Pipeline)
# ---------------------------------------------------------

def build_department_summary_pipeline(month: str) -> list:
    """
    Constructs a pure MongoDB aggregation pipeline that calculates department summary:
    1. Filters on employees joined on or before month_end.
    2. Dynamically derives employee working days using an array of month weekdays and $gte condition.
    3. Performs $lookup into attendance_logs for each employee in the target month.
    4. Computes weighted present days and collects late / overtime minutes.
    5. Groups by department to calculate headcount, total working days, total present days, and metric lists.
    6. Flattens lists with $reduce and computes averages via $avg, $divide, and $round.
    7. Sorts by department ascending.
    """
    year, month_num, num_days = validate_month_str(month, "month")
    month_start_str = f"{month}-01"
    month_end_str = f"{month}-{num_days:02d}"
    
    weekday_dates = []
    for d in range(1, num_days + 1):
        dt = date(year, month_num, d)
        if dt.weekday() < 5:  # Mon to Fri
            weekday_dates.append(dt.isoformat())
            
    return [
        {"$match": {"joined_on": {"$lte": month_end_str}}},
        {
            "$addFields": {
                "emp_working_days": {
                    "$size": {
                        "$filter": {
                            "input": weekday_dates,
                            "as": "d",
                            "cond": {"$gte": ["$$d", "$joined_on"]}
                        }
                    }
                }
            }
        },
        {
            "$lookup": {
                "from": "attendance_logs",
                "let": {"emp_code": "$emp_code"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$emp_code", "$$emp_code"]},
                                    {"$gte": ["$date", month_start_str]},
                                    {"$lte": ["$date", month_end_str]}
                                ]
                            }
                        }
                    }
                ],
                "as": "logs"
            }
        },
        {
            "$addFields": {
                "emp_present_days": {
                    "$sum": {
                        "$map": {
                            "input": {
                                "$filter": {
                                    "input": "$logs",
                                    "as": "l",
                                    "cond": {
                                        "$and": [
                                            {"$in": ["$$l.date", weekday_dates]},
                                            {"$in": ["$$l.status", ["PRESENT", "WFH", "ON_DUTY"]]}
                                        ]
                                    }
                                }
                            },
                            "as": "pl",
                            "in": {"$cond": [{"$eq": ["$$pl.half_day", True]}, 0.5, 1.0]}
                        }
                    }
                },
                "late_minutes_list": {
                    "$filter": {
                        "input": {"$map": {"input": "$logs", "as": "l", "in": "$$l.late_minutes"}},
                        "as": "lm",
                        "cond": {"$ne": ["$$lm", None]}
                    }
                },
                "overtime_minutes_list": {
                    "$filter": {
                        "input": {"$map": {"input": "$logs", "as": "l", "in": "$$l.overtime_minutes"}},
                        "as": "om",
                        "cond": {"$ne": ["$$om", None]}
                    }
                }
            }
        },
        {
            "$group": {
                "_id": "$department",
                "headcount": {"$sum": 1},
                "dept_working_days": {"$sum": "$emp_working_days"},
                "dept_present_days": {"$sum": "$emp_present_days"},
                "all_late_minutes": {"$push": "$late_minutes_list"},
                "all_overtime_minutes": {"$push": "$overtime_minutes_list"}
            }
        },
        {
            "$addFields": {
                "flat_late_minutes": {
                    "$reduce": {
                        "input": "$all_late_minutes",
                        "initialValue": [],
                        "in": {"$concatArrays": ["$$value", "$$this"]}
                    }
                },
                "flat_overtime_minutes": {
                    "$reduce": {
                        "input": "$all_overtime_minutes",
                        "initialValue": [],
                        "in": {"$concatArrays": ["$$value", "$$this"]}
                    }
                }
            }
        },
        {
            "$project": {
                "_id": 0,
                "department": "$_id",
                "month": {"$literal": month},
                "headcount": "$headcount",
                "total_present_days": {"$round": ["$dept_present_days", 2]},
                "avg_attendance_rate": {
                    "$cond": [
                        {"$gt": ["$dept_working_days", 0]},
                        {"$round": [{"$multiply": [{"$divide": ["$dept_present_days", "$dept_working_days"]}, 100]}, 2]},
                        0.0
                    ]
                },
                "avg_late_minutes": {
                    "$cond": [
                        {"$gt": [{"$size": "$flat_late_minutes"}, 0]},
                        {"$round": [{"$avg": "$flat_late_minutes"}, 2]},
                        0.0
                    ]
                },
                "avg_overtime_minutes": {
                    "$cond": [
                        {"$gt": [{"$size": "$flat_overtime_minutes"}, 0]},
                        {"$round": [{"$avg": "$flat_overtime_minutes"}, 2]},
                        0.0
                    ]
                }
            }
        },
        {"$sort": {"department": 1}}
    ]

@app.get("/analytics/departments/summary", tags=["Analytics"])
def department_monthly_summary(month: str = Query(...)):
    """Computes department monthly summaries entirely via database aggregation pipeline."""
    validate_month_str(month, "month")
    database = get_db()
    pipeline = build_department_summary_pipeline(month)
    return list(database.employees.aggregate(pipeline))

# ---------------------------------------------------------
# Phase 10: Late-Comers Leaderboard (Database-Side Pipeline)
# ---------------------------------------------------------

def build_late_leaderboard_pipeline(
    month: str,
    department: Optional[str] = None,
    limit: int = 10
) -> list:
    """
    Constructs a pure MongoDB aggregation pipeline that calculates late-comers leaderboard:
    1. Matches attendance logs with late_minutes > 0 in reporting month.
    2. Groups by emp_code to sum late minutes and count late days.
    3. Lookups employee info and unwinds.
    4. Filters by department if supplied.
    5. Computes ranks using $setWindowFields with $rank ordered by total_late_minutes DESC.
    6. Sorts deterministically by rank ASC, total_late_minutes DESC, emp_code ASC.
    7. Limits strictly after ranking and tie-breaking.
    """
    year, month_num, num_days = validate_month_str(month, "month")
    month_start_str = f"{month}-01"
    month_end_str = f"{month}-{num_days:02d}"
    
    pipeline: list[Dict[str, Any]] = [
        {
            "$match": {
                "date": {"$gte": month_start_str, "$lte": month_end_str},
                "late_minutes": {"$gt": 0}
            }
        },
        {
            "$group": {
                "_id": "$emp_code",
                "total_late_minutes": {"$sum": "$late_minutes"},
                "late_days_count": {"$sum": 1}
            }
        },
        {
            "$lookup": {
                "from": "employees",
                "localField": "_id",
                "foreignField": "emp_code",
                "as": "emp_info"
            }
        },
        {"$unwind": "$emp_info"}
    ]
    
    if department:
        pipeline.append({"$match": {"emp_info.department": department}})
        
    pipeline.extend([
        {
            "$setWindowFields": {
                "sortBy": {"total_late_minutes": -1},
                "output": {"rank": {"$rank": {}}}
            }
        },
        {"$sort": {"rank": 1, "total_late_minutes": -1, "_id": 1}},
        {"$limit": limit},
        {
            "$project": {
                "_id": 0,
                "rank": 1,
                "emp_code": "$_id",
                "name": "$emp_info.name",
                "department": "$emp_info.department",
                "late_days_count": 1,
                "total_late_minutes": 1
            }
        }
    ])
    return pipeline

@app.get("/analytics/leaderboard/late", tags=["Analytics"])
def late_leaderboard(
    month: str = Query(...),
    department: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=100)
):
    """Computes late-comers leaderboard entirely via MongoDB $setWindowFields aggregation pipeline."""
    validate_month_str(month, "month")
    database = get_db()
    pipeline = build_late_leaderboard_pipeline(month, department, limit)
    return list(database.attendance_logs.aggregate(pipeline))

# ---------------------------------------------------------
# Phase 11: Department Attendance Trend (Database-Side Pipeline)
# ---------------------------------------------------------

def build_department_trend_pipeline(
    department: str,
    date_from: str,
    date_to: str
) -> list:
    """
    Constructs a pure MongoDB 6.0+ aggregation pipeline that computes department trend:
    1. Filters on department and anchors with $limit: 1.
    2. Generates every calendar day in [date_from, date_to] using $range, $dateDiff, and $dateAdd.
    3. Uses $lookup into 'employees' to calculate daily eligible headcount (joined_on <= date).
    4. Uses $lookup into 'attendance_logs' to compute weighted present_count (0.5 for half_day, 1.0 for full day).
    5. Computes daily attendance_rate via $divide, $multiply, and $round.
    6. Computes 7-day moving average using $setWindowFields over {"documents": [-6, "current"]}.
    7. Projects exact response schema matching openapi.yaml.
    """
    start_date_str = date_from
    return [
        {"$match": {"department": department}},
        {"$limit": 1},
        {
            "$project": {
                "_id": 0,
                "days": {
                    "$range": [
                        0,
                        {
                            "$add": [
                                {
                                    "$dateDiff": {
                                        "startDate": {"$dateFromString": {"dateString": start_date_str}},
                                        "endDate": {"$dateFromString": {"dateString": date_to}},
                                        "unit": "day"
                                    }
                                },
                                1
                            ]
                        }
                    ]
                }
            }
        },
        {"$unwind": "$days"},
        {
            "$project": {
                "date": {
                    "$dateToString": {
                        "format": "%Y-%m-%d",
                        "date": {
                            "$dateAdd": {
                                "startDate": {"$dateFromString": {"dateString": start_date_str}},
                                "unit": "day",
                                "amount": "$days"
                            }
                        }
                    }
                }
            }
        },
        {
            "$lookup": {
                "from": "employees",
                "let": {"targetDate": "$date"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$department", department]},
                                    {"$lte": ["$joined_on", "$$targetDate"]}
                                ]
                            }
                        }
                    },
                    {"$project": {"_id": 0, "emp_code": 1}}
                ],
                "as": "dept_employees"
            }
        },
        {
            "$addFields": {
                "headcount": {"$size": "$dept_employees"},
                "emp_codes": "$dept_employees.emp_code"
            }
        },
        {
            "$lookup": {
                "from": "attendance_logs",
                "let": {"targetDate": "$date", "codes": "$emp_codes"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$in": ["$emp_code", "$$codes"]},
                                    {"$eq": ["$date", "$$targetDate"]},
                                    {"$in": ["$status", ["PRESENT", "WFH", "ON_DUTY"]]}
                                ]
                            }
                        }
                    },
                    {
                        "$project": {
                            "weight": {
                                "$cond": [{"$eq": ["$half_day", True]}, 0.5, 1.0]
                            }
                        }
                    },
                    {
                        "$group": {
                            "_id": None,
                            "total_present": {"$sum": "$weight"}
                        }
                    }
                ],
                "as": "attendance_agg"
            }
        },
        {
            "$addFields": {
                "present_count": {
                    "$ifNull": [
                        {"$arrayElemAt": ["$attendance_agg.total_present", 0]},
                        0.0
                    ]
                }
            }
        },
        {
            "$addFields": {
                "attendance_rate": {
                    "$cond": [
                        {"$gt": ["$headcount", 0]},
                        {
                            "$round": [
                                {
                                    "$multiply": [
                                        {"$divide": ["$present_count", "$headcount"]},
                                        100
                                    ]
                                },
                                2
                            ]
                        },
                        0.0
                    ]
                }
            }
        },
        {
            "$setWindowFields": {
                "sortBy": {"date": 1},
                "output": {
                    "moving_avg_raw": {
                        "$avg": "$attendance_rate",
                        "window": {
                            "documents": [-6, "current"]
                        }
                    }
                }
            }
        },
        {
            "$addFields": {
                "seven_day_moving_avg": {
                    "$round": ["$moving_avg_raw", 2]
                }
            }
        },
        {
            "$project": {
                "_id": 0,
                "date": 1,
                "headcount": 1,
                "present_count": 1,
                "attendance_rate": 1,
                "seven_day_moving_avg": 1
            }
        },
        {"$sort": {"date": 1}}
    ]

def build_compatible_department_trend_pipeline(
    department: str,
    date_from: str,
    date_to: str,
    date_list: list
) -> list:
    """
    Documented compatible database-side aggregation pipeline for environments lacking $setWindowFields
    or $dateDiff operators.
    """
    return [
        {"$match": {"department": department}},
        {"$limit": 1},
        {
            "$project": {
                "_id": 0,
                "date": {"$literal": date_list}
            }
        },
        {"$unwind": "$date"},
        {
            "$lookup": {
                "from": "employees",
                "let": {"targetDate": "$date"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$department", department]},
                                    {"$lte": ["$joined_on", "$$targetDate"]}
                                ]
                            }
                        }
                    },
                    {"$project": {"_id": 0, "emp_code": 1}}
                ],
                "as": "dept_employees"
            }
        },
        {
            "$addFields": {
                "headcount": {"$size": "$dept_employees"},
                "emp_codes": "$dept_employees.emp_code"
            }
        },
        {
            "$lookup": {
                "from": "attendance_logs",
                "let": {"targetDate": "$date", "codes": "$emp_codes"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$in": ["$emp_code", "$$codes"]},
                                    {"$eq": ["$date", "$$targetDate"]},
                                    {"$in": ["$status", ["PRESENT", "WFH", "ON_DUTY"]]}
                                ]
                            }
                        }
                    },
                    {
                        "$project": {
                            "weight": {
                                "$cond": [{"$eq": ["$half_day", True]}, 0.5, 1.0]
                            }
                        }
                    },
                    {
                        "$group": {
                            "_id": None,
                            "total_present": {"$sum": "$weight"}
                        }
                    }
                ],
                "as": "attendance_agg"
            }
        },
        {
            "$addFields": {
                "present_count": {
                    "$ifNull": [
                        {"$arrayElemAt": ["$attendance_agg.total_present", 0]},
                        0.0
                    ]
                }
            }
        },
        {
            "$addFields": {
                "attendance_rate": {
                    "$cond": [
                        {"$gt": ["$headcount", 0]},
                        {
                            "$round": [
                                {
                                    "$multiply": [
                                        {"$divide": ["$present_count", "$headcount"]},
                                        100
                                    ]
                                },
                                2
                            ]
                        },
                        0.0
                    ]
                }
            }
        },
        {
            "$project": {
                "_id": 0,
                "date": 1,
                "headcount": 1,
                "present_count": 1,
                "attendance_rate": 1
            }
        },
        {"$sort": {"date": 1}},
        {
            "$group": {
                "_id": None,
                "items": {"$push": "$$ROOT"}
            }
        },
        {
            "$project": {
                "trend": {
                    "$map": {
                        "input": {"$range": [0, {"$size": "$items"}]},
                        "as": "idx",
                        "in": {
                            "$let": {
                                "vars": {
                                    "curr": {"$arrayElemAt": ["$items", "$$idx"]},
                                    "start_pos": {
                                        "$cond": [
                                            {"$gte": ["$$idx", 6]},
                                            {"$subtract": ["$$idx", 6]},
                                            0
                                        ]
                                    },
                                    "window_len": {
                                        "$cond": [
                                            {"$gte": ["$$idx", 6]},
                                            7,
                                            {"$add": ["$$idx", 1]}
                                        ]
                                    }
                                },
                                "in": {
                                    "$let": {
                                        "vars": {
                                            "window": {
                                                "$slice": ["$items", "$$start_pos", "$$window_len"]
                                            }
                                        },
                                        "in": {
                                            "date": "$$curr.date",
                                            "headcount": "$$curr.headcount",
                                            "present_count": "$$curr.present_count",
                                            "attendance_rate": "$$curr.attendance_rate",
                                            "seven_day_moving_avg": {
                                                "$round": [
                                                    {"$avg": "$$window.attendance_rate"},
                                                    2
                                                ]
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        {"$unwind": "$trend"},
        {"$replaceRoot": {"newRoot": "$trend"}},
        {"$sort": {"date": 1}}
    ]

@app.get("/analytics/departments/{department}/trend", tags=["Analytics"])
def department_attendance_trend(
    department: str = Path(...),
    date_from: str = Query(...),
    date_to: str = Query(...)
):
    d_start = validate_calendar_date(date_from, "date_from")
    d_end = validate_calendar_date(date_to, "date_to")
    
    if d_end < d_start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date_to cannot be earlier than date_from."
        )
        
    database = get_db()
    
    dept_employees_count = database.employees.count_documents({"department": department})
    if dept_employees_count == 0:
        return []
        
    try:
        # Primary: Pure MongoDB 6.0+ aggregation pipeline with $dateDiff, $dateAdd, and $setWindowFields
        pipeline = build_department_trend_pipeline(department, date_from, date_to)
        return list(database.employees.aggregate(pipeline))
    except OperationFailure as e:
        err_msg = str(e).lower()
        unsupported_keywords = ["unrecognized pipeline stage", "unknown stage", "setwindowfields", "datediff", "dateadd", "location40324"]
        if any(kw in err_msg for kw in unsupported_keywords):
            try:
                num_days = (d_end - d_start).days + 1
                date_list = [(d_start + timedelta(days=i)).isoformat() for i in range(num_days)]
                pipeline = build_compatible_department_trend_pipeline(department, date_from, date_to, date_list)
                return list(database.employees.aggregate(pipeline))
            except Exception as fallback_err:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Compatible pipeline failed: {str(fallback_err)}"
                )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database aggregation failed: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database aggregation failed: {str(e)}"
        )

# ---------------------------------------------------------
# Phase 12: Admin Explain Endpoint
# ---------------------------------------------------------

@app.get("/admin/explain/{endpoint_name}", tags=["Admin"])
def explain_endpoint(
    endpoint_name: str = Path(...),
    department: Optional[str] = Query(None),
    emp_code: Optional[str] = Query(None),
    month: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None)
):
    allowed_endpoints = {"attendance_list", "employee_monthly", "department_summary", "late_leaderboard", "department_trend"}
    if endpoint_name not in allowed_endpoints:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported endpoint name '{endpoint_name}'. Must be one of: {sorted(list(allowed_endpoints))}"
        )
        
    if month:
        validate_month_str(month, "month")
    if date_from:
        validate_calendar_date(date_from, "date_from")
    if date_to:
        validate_calendar_date(date_to, "date_to")
        
    database = get_db()
    
    try:
        if endpoint_name == "attendance_list":
            filter_q: Dict[str, Any] = {}
            if emp_code:
                filter_q["emp_code"] = emp_code
            if date_from or date_to:
                dq = {}
                if date_from:
                    dq["$gte"] = date_from
                if date_to:
                    dq["$lte"] = date_to
                filter_q["date"] = dq
            return database.command(
                "explain",
                {"find": "attendance_logs", "filter": filter_q, "sort": {"date": -1}},
                verbosity="executionStats"
            )
            
        elif endpoint_name == "employee_monthly":
            code = emp_code or "EMP001"
            m = month or "2024-05"
            y, mn, num_days = validate_month_str(m, "month")
            filter_q = {
                "emp_code": code,
                "date": {"$gte": f"{m}-01", "$lte": f"{m}-{num_days:02d}"}
            }
            return database.command(
                "explain",
                {"find": "attendance_logs", "filter": filter_q, "sort": {"date": -1}},
                verbosity="executionStats"
            )
            
        elif endpoint_name == "department_summary":
            m = month or "2024-05"
            pipeline = build_department_summary_pipeline(m)
            return database.command(
                "explain",
                {"aggregate": "employees", "pipeline": pipeline, "cursor": {}},
                verbosity="executionStats"
            )
            
        elif endpoint_name == "late_leaderboard":
            m = month or "2024-05"
            pipeline = build_late_leaderboard_pipeline(m, department, 10)
            return database.command(
                "explain",
                {"aggregate": "attendance_logs", "pipeline": pipeline, "cursor": {}},
                verbosity="executionStats"
            )
            
        elif endpoint_name == "department_trend":
            dept = department or "Engineering"
            d_f = date_from or "2024-05-01"
            d_t = date_to or "2024-05-07"
            pipeline = build_department_trend_pipeline(dept, d_f, d_t)
            return database.command(
                "explain",
                {"aggregate": "employees", "pipeline": pipeline, "cursor": {}},
                verbosity="executionStats"
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"MongoDB explain failed for '{endpoint_name}': {str(e)}"
        )
