# Data Model & Storage Specification

This document details the MongoDB schema, data types, indexing strategies, and concurrency patterns used in the **Employee Attendance & Analytics API**.

---

## 1. Collections Overview

The application utilizes two primary collections in MongoDB:
1. `employees` — Static and organizational profile of employees, shift configurations, and joining dates.
2. `attendance_logs` — Daily attendance event records, calculated work metrics, and regularization audit history.

---

## 2. Collection: `employees`

### Document Structure (BSON)
```json
{
  "_id": ObjectId("664c1234abcd5678ef012345"),
  "emp_code": "EMP001",
  "name": "Aarav Sharma",
  "email": "aarav.sharma@example.com",
  "department": "Engineering",
  "shift_start": "09:30",
  "shift_end": "18:30",
  "joined_on": "2024-01-15",
  "created_at": ISODate("2024-01-15T04:00:00.000Z")
}
```

### Fields & Constraints

| Field | BSON Type | Python / JSON Type | Constraints / Description |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Internal | Internal MongoDB identifier. **Never returned in API responses**. |
| `emp_code` | `String` | `str` | Case-insensitive normalized or unique business key (e.g., `EMP001`). Indexed with **Unique constraint**. |
| `name` | `String` | `str` | Full employee name. |
| `email` | `String` | `str` | Valid email address. |
| `department` | `String` | `str` | Exact department name (e.g. `Engineering`, `Product`, `Operations`). Case-sensitive. |
| `shift_start` | `String` | `str` | Shift start time in `HH:MM` 24-hour format in IST. |
| `shift_end` | `String` | `str` | Shift end time in `HH:MM` 24-hour format in IST. Must not equal `shift_start`. If `shift_end <= shift_start`, this indicates an **overnight shift**. |
| `joined_on` | `String` | `str` | ISO calendar date string `YYYY-MM-DD`. Used for prorated monthly working days calculation. |
| `created_at` | `Date` | `datetime` | Server-generated timestamp when employee document was created. |

### Indexes

1. **Unique Employee Code**:
   ```javascript
   db.employees.createIndex({ "emp_code": 1 }, { unique: true, name: "idx_emp_code_unique" })
   ```
   *Purpose:* Guarantees uniqueness of `emp_code` under high concurrency. Prevents race conditions during simultaneous employee creation.

2. **Department Filter & Sorting**:
   ```javascript
   db.employees.createIndex({ "department": 1, "emp_code": 1 }, { name: "idx_dept_emp_code" })
   ```
   *Purpose:* Satisfies `GET /employees?department=...` with sorting by `emp_code` without in-memory sort or collscan.

---

## 3. Collection: `attendance_logs`

### Document Structure (BSON)
```json
{
  "_id": ObjectId("664c9876dcba4321fe987654"),
  "emp_code": "EMP001",
  "date": "2024-05-20",
  "status": "PRESENT",
  "punch_in": ISODate("2024-05-20T04:05:00.000Z"),
  "punch_out": ISODate("2024-05-20T13:05:00.000Z"),
  "late_minutes": 5,
  "work_hours": 9.00,
  "overtime_minutes": 35,
  "half_day": false,
  "history": [
    {
      "at": ISODate("2024-05-21T06:00:00.000Z"),
      "by": "admin_user",
      "reason": "Biometric system glitch",
      "changes": {
        "status": { "old": "ABSENT", "new": "PRESENT" }
      }
    }
  ],
  "version": 1
}
```

### Fields & Constraints

| Field | BSON Type | Python / API Type | Description |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Internal | Never exposed via API. |
| `emp_code` | `String` | `str` | Foreign key referencing `employees.emp_code`. |
| `date` | `String` | `str` | IST calendar date `YYYY-MM-DD`. For overnight shifts punching in after midnight before shift end, date is assigned to the **previous day**. |
| `status` | `String` | `str` | One of `PRESENT`, `WFH`, `ON_DUTY`, `ABSENT`, `LEAVE`. |
| `punch_in` | `Date` / `Null` | Epoch ms (int) | Stored as BSON `Date` truncated to whole second. Serialized as integer epoch milliseconds in API. |
| `punch_out` | `Date` / `Null` | Epoch ms (int) | Stored as BSON `Date` truncated to whole second, or `null`. |
| `late_minutes` | `Int32` | `int` | Computed at punch-in: 0 if punch-in <= shift_start + 10m grace period; otherwise elapsed whole minutes from shift start. |
| `work_hours` | `Double` / `Null` | `float` (2 decimals) | Duration between punch_in and punch_out converted to hours and rounded using **Decimal half-up** (`ROUND_HALF_UP`). `null` if not punched out. |
| `overtime_minutes` | `Int32` | `int` | Whole minutes after scheduled shift end. 0 if < 30 minutes. |
| `half_day` | `Boolean` | `bool` | `true` if `work_hours < 4.50` after punch out; `false` otherwise. |
| `history` | `Array<Document>` | `list[dict]` | Audit log of manual regularizations. Empty `[]` initially. |
| `version` | `Int32` | `int` | Optimistic locking counter to prevent lost updates during concurrent edits. |

### Indexes

1. **Compound Unique Index on `(emp_code, date)`**:
   ```javascript
   db.attendance_logs.createIndex(
     { "emp_code": 1, "date": 1 },
     { unique: true, name: "idx_emp_code_date_unique" }
   )
   ```
   *Purpose:* Single source of truth guaranteeing at most one attendance record per employee per shift date. Handles concurrent punch-in races via atomic database rejection (`E11000 duplicate key error`).

2. **Date Range and Analytics Index**:
   ```javascript
   db.attendance_logs.createIndex(
     { "date": -1, "status": 1 },
     { name: "idx_date_desc_status" }
   )
   ```
   *Purpose:* Speeds up `GET /attendance` date range filtering and sorting (`date DESC`).

3. **Employee Date Range Index**:
   ```javascript
   db.attendance_logs.createIndex(
     { "emp_code": 1, "date": -1 },
     { name: "idx_emp_code_date_desc" }
   )
   ```
   *Purpose:* Used for single-employee monthly queries (`GET /analytics/employees/{emp_code}/monthly`), active punch-out lookup, and employee attendance history.

---

## 4. Concurrency & Atomicity Mechanics

### 1. Concurrent Duplicate Punch-Ins
- **Pattern:** Direct `insert_one()` wrapped in `try/except DuplicateKeyError`.
- **Guarantee:** Exactly one request succeeds with HTTP 201; concurrent duplicate requests immediately receive HTTP 409 Conflict. Zero race condition windows.

### 2. Concurrent Duplicate Punch-Outs
- **Pattern:** Atomic `find_one_and_update`:
  ```python
  filter = {
      "emp_code": emp_code,
      "date": shift_date,
      "punch_out": None  # Only matches if not yet punched out
  }
  update = {
      "$set": {
          "punch_out": punch_out_dt,
          "work_hours": work_hours,
          "overtime_minutes": overtime_minutes,
          "half_day": half_day
      }
  }
  ```
- **Guarantee:** If two threads attempt to punch out simultaneously, only one will find `punch_out: None`. The second finds no document matching the filter and returns HTTP 409 Conflict.

### 3. Concurrent Regularizations
- **Pattern:** Atomic `$push` to `history` combined with field updates, using either optimistic version check (`version: current_version`) or atomic conditional update.
- **Guarantee:** No overwritten history entries, no lost updates.

---

## 5. Department Attendance Trend Database-Side Pipelines

### Primary MongoDB 6.0+ Aggregation Pipeline
- **Anchor & Filter:** Starts with `employees` filtered by `$match: { department: <dept> }` and `$limit: 1`.
- **Date Series Generation:** Uses `$range`, `$dateDiff`, and `$dateAdd` in `$project` followed by `$unwind` to generate continuous calendar days (including weekends) in `[date_from, date_to]`.
- **Headcount Calculation:** Subpipeline `$lookup` into `employees` matching `department == <dept>` and `joined_on <= date`. Dynamically derives daily headcount via `$size: "$dept_employees"`, counting employees even if they possess zero attendance logs.
- **Present Count Calculation:** Subpipeline `$lookup` into `attendance_logs` matching `emp_codes`, `date`, and eligible statuses (`PRESENT`, `WFH`, `ON_DUTY`). Dynamically weighs half-day logs as `0.5` and full days as `1.0`, zero-filling missing dates.
- **Daily Attendance Rate:** `$round(($present_count / $headcount) * 100, 2)` (or `0.0` if `headcount == 0`).
- **Rolling Moving Average:** Computed natively within MongoDB using `$setWindowFields` with `sortBy: { date: 1 }` and `window: { documents: [-6, "current"] }`. Naturally accommodates early dates (1 to 6 days) using the available preceding window.

### Compatible Database-Side Pipeline
- For environments lacking window operators, uses parameter-injected dates with database-side `$group: { _id: null, items: { $push: "$$ROOT" } }` combined with `$map`, `$slice`, `$avg`, and `$unwind`.
- Zero application memory heap loops or dictionaries; the entire calculation is executed inside MongoDB's query engine.
