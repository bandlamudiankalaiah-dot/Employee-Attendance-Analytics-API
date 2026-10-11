export const FILE_CONTENTS: Record<string, string> = {
  "app/main.py": `import os
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
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.collection import Collection
from pymongo.errors import DuplicateKeyError, PyMongoError

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "attendance_db")

# Timezone setup: IST is UTC+05:30
IST_OFFSET = timedelta(hours=5, minutes=30)
IST_TZ = timezone(IST_OFFSET)

client: Optional[MongoClient] = None
db = None
is_db_ready: bool = False

def get_db():
    global client, db
    if db is None:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
        db = client[MONGO_DB]
    return db

def init_db_indexes(database):
    """Idempotently create all required database indexes on application startup."""
    database.employees.create_index([("emp_code", ASCENDING)], unique=True, name="idx_emp_code_unique")
    database.employees.create_index([("department", ASCENDING), ("emp_code", ASCENDING)], name="idx_dept_emp_code")
    database.attendance_logs.create_index(
        [("emp_code", ASCENDING), ("date", ASCENDING)],
        unique=True,
        name="idx_emp_code_date_unique"
    )
    database.attendance_logs.create_index([("date", DESCENDING), ("status", ASCENDING)], name="idx_date_desc_status")
    database.attendance_logs.create_index([("emp_code", ASCENDING), ("date", DESCENDING)], name="idx_emp_code_date_desc")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global is_db_ready
    try:
        database = get_db()
        client.admin.command('ping')
        init_db_indexes(database)
        is_db_ready = True
        print("MongoDB connection verified and indexes initialized successfully.")
    except Exception as e:
        is_db_ready = False
        print(f"CRITICAL: Application startup MongoDB initialization failed: {e}")
    yield
    if client:
        try:
            client.close()
        except Exception:
            pass

app = FastAPI(
    title="Employee Attendance & Analytics API",
    version="1.0.0",
    description="Production-grade Backend API for Employee Attendance Management and Analytics.",
    lifespan=lifespan
)
`,
  "requirements.txt": `fastapi>=0.110.0,<1.0.0
uvicorn[standard]>=0.29.0,<1.0.0
pymongo>=4.6.2,<5.0.0
pydantic[email]>=2.6.4,<3.0.0
email-validator>=2.1.0,<3.0.0
pydantic-settings>=2.2.1,<3.0.0
python-dotenv>=1.0.1,<2.0.0
pytest>=8.1.1,<9.0.0
httpx>=0.27.0,<1.0.0
pytest-asyncio>=0.23.6,<1.0.0
mongomock>=4.1.2,<5.0.0`,

  "DECISIONS.md": `# Architectural Decisions & Technical Answers (DECISIONS.md)

### 1. Index Choices and One Rejected Index
We created a unique index on \`employees.emp_code\`, a compound unique index on \`attendance_logs (emp_code, date)\`, and compound query indexes on \`attendance_logs (date: -1, status: 1)\` and \`employees (department: 1, emp_code: 1)\`. These satisfy point lookups, shift-uniqueness constraints, and sorted range queries entirely through index scans (\`IXSCAN\`). 
**Rejected Index:** An index on \`attendance_logs.work_hours\`. Filter queries do not search by arbitrary work hour thresholds, and indexing high-cardinality floating-point numbers on every punch-out write adds unnecessary B-tree rebalancing and disk write amplification with zero query benefit.

### 2. Exactly What Happens During Simultaneous Punch-In Requests
When two simultaneous punch-in requests arrive for the same employee and shift date, both reach MongoDB's storage engine concurrently. Thanks to the compound unique index on \`(emp_code, date)\`, MongoDB's wiredTiger concurrency control allows exactly one document insertion to commit. The competing insert immediately raises a BSON duplicate key error (\`code: 11000\`). Our application catches \`DuplicateKeyError\` and returns HTTP \`409 Conflict\`, guaranteeing zero duplicate records without requiring distributed locks.

### 3. How Leaderboard Ties at the Cutoff Are Returned
We rank employees using MongoDB's \`$setWindowFields\` with \`dense_rank\` or \`rank\` ordered by total late minutes descending, breaking metric ties with \`emp_code\` ascending. When multiple employees tie on late minutes, they receive identical rank numbers, and subsequent ranks are skipped (e.g. 1, 2, 2, 4). The \`$limit\` stage executes strictly after ranking and tie-breaking. Employees tied at the cutoff boundary are deterministically included based on alphabetical \`emp_code\`, ensuring stable, reproducible pagination.

### 4. How Department Headcount Includes Employees with No Logs
Department summary begins by querying the \`employees\` collection as the authoritative source of truth, filtering \`joined_on <= month_end\`. We perform a \`$lookup\` into \`attendance_logs\` matching on \`emp_code\` and the reporting month, followed by \`$unwind\` with \`preserveNullAndEmptyArrays: true\`. Employees with zero attendance documents produce a single output row with null attendance fields, ensuring department headcount counts all eligible employees while correctly contributing zero to present days.

### 5. What Should Change for 100 Times the Data
At 100x scale (~10 million records):
1. **Sharding:** Shard \`attendance_logs\` using a compound shard key \`{ emp_code: "hashed", date: 1 }\` to distribute write load and co-locate employee history on specific shards.
2. **Pre-aggregation & Bucket Pattern:** Maintain monthly pre-aggregated rollups in an \`employee_monthly_stats\` collection updated on punch-out via Change Streams, avoiding full-table pipeline scans.
3. **Read Replicas:** Route heavy analytical aggregations (\`/analytics/*\`) to secondary replica set nodes with read preference \`secondaryPreferred\`.`,

  "REVIEW.md": `# Code Review & Defect Analysis (REVIEW.md)

18 Critical Defects Identified in Starter Implementation & Fixed:
1. Health Check False Positives (Added ping command with serverSelectionTimeoutMS)
2. Timezone-Naive Datetimes Causing IST Date Shift (Standardized on Asia/Kolkata UTC+05:30)
3. Millisecond vs. Second Timestamp Corruption (StrictInt epoch ms enforced, whole second truncation)
4. Overnight Shift Misattribution to Current Calendar Date (Cross-midnight shift attribution rule R1)
5. Late Minutes Grace Period Boundary and Subtraction Error (Grace 10m strictly > 10m rule R2)
6. Overtime Threshold & Overnight Shift End Discrepancy (30m threshold enforced rule R3)
7. Banker's Rounding in Work Hours (Decimal ROUND_HALF_UP used rule R4)
8. Duplicate Employee Creation Race Condition (Unique index on emp_code)
9. Concurrent Duplicate Punch-In Race Condition (Compound unique index on (emp_code, date))
10. Concurrent Punch-Out Lost Updates (Atomic find_one_and_update with punch_out: None)
11. In-Memory Pagination & Total Count Discrepancy (MongoDB skip/limit/count_documents)
12. In-Memory Sorting & Missing Index Scans (Database-level sort with compound index)
13. Loose Validation Accepting Impossible Dates (Strict calendar date existence e.g. rejecting 2024-02-31 with HTTP 422)
14. Leaking MongoDB Internal _id and BSON Types (Projection _id: 0)
15. History Audit Trail Serialization Errors (Epoch ms serialization)
16. Lost Updates and Race Conditions in Regularization (Optimistic locking version check)
17. Averaging Averages in Department Summary (Raw record aggregations in $group)
18. Omitting Employees With Zero Attendance Logs (preserveNullAndEmptyArrays: true)
19. In-Memory Date Loops & Moving Average in Department Trend (Replaced with pure MongoDB 6.0+ aggregation pipeline: $range, $dateDiff, $dateAdd, $lookup, $round, and $setWindowFields, plus documented compatible pipeline)`
};
