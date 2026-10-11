# Architectural Decisions & Technical Answers (DECISIONS.md)

### 1. Index Choices and One Rejected Index
We created a unique index on `employees.emp_code`, a compound unique index on `attendance_logs (emp_code, date)`, and compound query indexes on `attendance_logs (date: -1, status: 1)` and `employees (department: 1, emp_code: 1)`. These satisfy point lookups, shift-uniqueness constraints, and sorted range queries entirely through index scans (`IXSCAN`). 
**Rejected Index:** An index on `attendance_logs.work_hours`. Filter queries do not search by arbitrary work hour thresholds, and indexing high-cardinality floating-point numbers on every punch-out write adds unnecessary B-tree rebalancing and disk write amplification with zero query benefit.

### 2. Exactly What Happens During Simultaneous Punch-In Requests
When two simultaneous punch-in requests arrive for the same employee and shift date, both reach MongoDB's storage engine concurrently. Thanks to the compound unique index on `(emp_code, date)`, MongoDB's wiredTiger concurrency control allows exactly one document insertion to commit. The competing insert immediately raises a BSON duplicate key error (`code: 11000`). Our application catches `DuplicateKeyError` and returns HTTP `409 Conflict`, guaranteeing zero duplicate records without requiring distributed locks.

### 3. How Leaderboard Ties at the Cutoff Are Returned
We rank employees using MongoDB's `$setWindowFields` with `dense_rank` or `rank` ordered by total late minutes descending, breaking metric ties with `emp_code` ascending. When multiple employees tie on late minutes, they receive identical rank numbers, and subsequent ranks are skipped (e.g. 1, 2, 2, 4). The `$limit` stage executes strictly after ranking and tie-breaking. Employees tied at the cutoff boundary are deterministically included based on alphabetical `emp_code`, ensuring stable, reproducible pagination.

### 4. How Department Headcount Includes Employees with No Logs
Department summary begins by querying the `employees` collection as the authoritative source of truth, filtering `joined_on <= month_end`. We perform a `$lookup` into `attendance_logs` matching on `emp_code` and the reporting month, followed by `$unwind` with `preserveNullAndEmptyArrays: true`. Employees with zero attendance documents produce a single output row with null attendance fields, ensuring department headcount counts all eligible employees while correctly contributing zero to present days.

### 5. What Should Change for 100 Times the Data
At 100x scale (~10 million records):
1. **Sharding:** Shard `attendance_logs` using a compound shard key `{ emp_code: "hashed", date: 1 }` to distribute write load and co-locate employee history on specific shards.
2. **Pre-aggregation & Bucket Pattern:** Maintain monthly pre-aggregated rollups in an `employee_monthly_stats` collection updated on punch-out via Change Streams, avoiding full-table pipeline scans.
3. **Read Replicas:** Route heavy analytical aggregations (`/analytics/*`) to secondary replica set nodes with read preference `secondaryPreferred`.
