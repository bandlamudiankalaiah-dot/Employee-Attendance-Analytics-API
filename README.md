# Employee Attendance & Analytics API

A high-performance, production-grade backend service built with **Python 3.11+**, **FastAPI**, **Pydantic v2**, and **MongoDB (PyMongo)**. 

Designed for high-concurrency environments, strict timezone handling (IST UTC+05:30), overnight shifts, race-safe atomic punch operations, audit trail regularization, and database-side analytics using optimized MongoDB aggregation pipelines.

---

## 🌟 Key Features

1. **Shift & Overnight Intelligence (Rule R1)**:
   - Full support for normal day shifts and overnight shifts crossing midnight (e.g., `22:00` to `06:00`).
   - Clock-ins after midnight before shift end are assigned to the previous calendar day's shift.
   - All calendar dates normalized to Indian Standard Time (IST, UTC+05:30).

2. **Late-Comers Calculation with Grace Period (Rule R2)**:
   - Configurable 10-minute grace window.
   - Punching in at `09:40:00` for a `09:30` shift incurs **0 late minutes**.
   - Punching in at `09:40:01` incurs **10 late minutes** (full elapsed time from shift start).

3. **Overtime & Work Hours Precision (Rules R3, R4, R5)**:
   - Contractual **Decimal Half-Up rounding** (`ROUND_HALF_UP`) to 2 decimal places (eliminating IEEE-754 Banker's rounding bias).
   - Strict 30-minute threshold: Overtime is 0 unless worked time past scheduled end is $\ge 30$ minutes.
   - Half-day threshold: Automatically flagged if `work_hours < 4.50`.

4. **Zero-Race Concurrency Guarantees**:
   - Simultaneous punch-ins for the same employee on the same date are rejected with HTTP 409 Conflict via a compound unique index on `(emp_code, date)`.
   - Simultaneous punch-outs are protected via atomic `find_one_and_update` on `{"punch_out": None}`.
   - Optimistic concurrency control (`version` counter) prevents lost updates during manual regularization.

5. **Database-Side Analytics & Window Ranking**:
   - Zero in-memory sorting or full-table memory loading; all queries execute via targeted MongoDB indexes (`IXSCAN`).
   - MongoDB `$lookup` with `preserveNullAndEmptyArrays: true` ensures employees with 0 logs are preserved in department headcount.
   - Leaderboard rankings use dense window ranking (skipping ranks after ties: 1, 2, 2, 4) with alphabetical tie-breaking.
   - 7-day moving average attendance trend with gap filling for missing dates and weekends.

6. **Full Observability & Explain Plan Inspector**:
   - Dedicated `GET /admin/explain/{endpoint}` providing raw `executionStats` query explain plans.

---

## 🛠️ Technology Stack

- **Runtime:** Python 3.11+
- **Framework:** FastAPI 0.110+
- **ASGI Server:** Uvicorn
- **Database:** MongoDB 6.0+ (PyMongo 4.6+)
- **Data Validation:** Pydantic v2
- **Testing:** Pytest, HTTPX, MongoMock
- **Environment Management:** python-dotenv

---

## 📁 Project Structure

```
├── app/
│   ├── __init__.py
│   └── main.py              # Primary application code, routes, schemas & models
├── tests/
│   ├── __init__.py
│   ├── conftest.py          # Pytest fixtures and test database setup
│   └── test_api.py          # Comprehensive test suite (30+ test cases)
├── DATA_MODEL.md            # MongoDB document schemas, BSON types & indexes
├── REVIEW.md                # 18 identified starter code bugs & production fixes
├── DECISIONS.md             # 5 core architectural interview questions & answers
├── openapi.yaml             # Complete OpenAPI 3.1 specification
├── sample_seed.py           # Seed script with realistic shifts & 100k scale generator
├── requirements.txt         # Production and development dependencies
└── README.md                # Master documentation and run guide
```

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory (overridden by real system environment variables):

```bash
# MongoDB Connection URI
MONGO_URI="mongodb://localhost:27017"

# Database Name
MONGO_DB="attendance_db"
```

---

## 🚀 Setup & Execution Guide (Windows PowerShell)

Follow these exact steps to run the project locally on Windows:

### 1. Prerequisites
- Python 3.11 or later installed (ensure `Add python.exe to PATH` was checked during installation).
- MongoDB Community Server 6.0+ running locally (e.g. via Windows Service) or a MongoDB Atlas URI.

### 2. Setup Virtual Environment
Open PowerShell inside the project directory:
```powershell
# Create virtual environment
python -m venv venv

# Activate virtual environment
.\venv\Scripts\Activate.ps1
```
*(If PowerShell restricts script execution, run: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`)*

### 3. Install Dependencies
```powershell
pip install -r requirements.txt
```

### 4. Seed the Database
Populate the database with realistic sample shifts, overnight workers, and edge cases:
```powershell
python sample_seed.py

# Optional: Generate up to 100,000 synthetic records to test explain plan index performance
python sample_seed.py --100k
```

### 5. Start the API Server
Run the application using the required entry point:
```powershell
uvicorn app.main:app --port 8000 --reload
```

The API will be available at:
- Swagger Interactive Documentation: `http://127.0.0.1:8000/docs`
- ReDoc Documentation: `http://127.0.0.1:8000/redoc`
- Health Check: `http://127.0.0.1:8000/health`

---

## 🧪 Running Automated Tests

Run the full pytest suite with verbose output:

```powershell
pytest -v
```

To run with coverage reporting:
```powershell
pytest --cov=app tests/
```

All 32 automated tests validate:
- Decimal round-half-up math precision (`ROUND_HALF_UP`)
- Grace-period boundary conditions (`09:40:00` vs `09:40:01`)
- Overtime 30-minute thresholding and half-day flag
- Overnight shift date attribution across midnight
- Concurrent duplicate punch-in rejection (`HTTP 409 Conflict`)
- Concurrent duplicate punch-out race safety (`find_one_and_update`, `HTTP 409 Conflict`)
- Punch-out strict shift date matching (preventing stale incomplete records from being selected)
- Late-comers leaderboard with `$setWindowFields` ranking ties (1, 2, 2, 4) and deterministic cutoff sorting
- Pure database-side department summary aggregation pipeline with prorated working days and zero-log retention
- Department attendance trend pipeline with continuous calendar days, gap filling, and 7-day moving average
- Genuine MongoDB `executionStats` query explain plans and honest 500 error reporting on failure
- Lifespan startup readiness failure detection (`HTTP 503 Service Unavailable` on connection or index failure)
- Safe, non-wildcard credentialed CORS configuration

---

## 📖 API Endpoint Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Verifies service and MongoDB ping |
| `POST` | `/employees` | Registers employee; unique `emp_code` enforced |
| `GET` | `/employees` | Lists employees with department filter & pagination |
| `POST` | `/attendance/punch-in` | Punch in; calculates `late_minutes` |
| `POST` | `/attendance/punch-out` | Punch out; calculates `work_hours`, `overtime_minutes`, `half_day` |
| `GET` | `/attendance` | Filterable attendance history sorted by date DESC |
| `PATCH` | `/attendance/{emp_code}/{date}` | Regularization with audit trail and atomic versioning |
| `GET` | `/analytics/employees/{emp_code}/monthly` | Monthly employee presence and prorated working days |
| `GET` | `/analytics/departments/summary` | Department-level headcount, attendance rate, avg OT/late |
| `GET` | `/analytics/leaderboard/late` | Late arrivals leaderboard with dense window ranking |
| `GET` | `/analytics/departments/{dept}/trend` | Daily attendance trend & 7-day moving average |
| `GET` | `/admin/explain/{endpoint}` | Raw MongoDB `executionStats` query explain plans |

---

## 💡 Example Request & Response

### Punch-In Request
`POST /attendance/punch-in`
```json
{
  "emp_code": "EMP001",
  "punched_at": 1716177601000,
  "status": "PRESENT"
}
```

### Punch-In Response (`HTTP 201 Created`)
```json
{
  "emp_code": "EMP001",
  "date": "2024-05-20",
  "status": "PRESENT",
  "punch_in": 1716177601000,
  "punch_out": null,
  "late_minutes": 10,
  "work_hours": null,
  "overtime_minutes": 0,
  "half_day": false,
  "history": []
}
```

---

## 🔒 Known Limitations & Production Recommendations

1. **Distributed Clocks:** In multi-server deployments where employee hardware clocks might drift, ensure all biometric scanners synchronize via NTP.
2. **MongoDB Replica Set for Transactions:** If multi-document ACID transactions across `employees` and `attendance_logs` are ever required in future phases, MongoDB must be run as a replica set.
3. **Pre-aggregations at Scale:** For organizations exceeding 50,000 employees with tens of millions of records, consider maintaining monthly pre-aggregated rollups updated via MongoDB Change Streams.
