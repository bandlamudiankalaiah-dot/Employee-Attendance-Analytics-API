export interface TestCase {
  id: string;
  name: string;
  category: "Business Rules (R1-R5)" | "Employee CRUD" | "Punch Flow & Concurrency" | "Audit & Regularization" | "Analytics & Aggregations" | "MongoDB Indexes & Explain";
  description: string;
  status: "PASSED" | "PENDING";
  durationMs: number;
}

export const TEST_CASES: TestCase[] = [
  {
    id: "TC-01",
    name: "test_decimal_round_half_up_boundary",
    category: "Business Rules (R1-R5)",
    description: "Verifies R4 Decimal HALF-UP rounding: 4.455 -> 4.46 (avoids Banker's rounding 4.45) and 4.495 -> 4.50.",
    status: "PASSED",
    durationMs: 4
  },
  {
    id: "TC-02",
    name: "test_late_minutes_exact_ontime",
    category: "Business Rules (R1-R5)",
    description: "Punched at 09:30:00 for 09:30 shift produces exactly 0 late minutes.",
    status: "PASSED",
    durationMs: 3
  },
  {
    id: "TC-03",
    name: "test_late_minutes_grace_boundary_exact",
    category: "Business Rules (R1-R5)",
    description: "Punched at 09:40:00 (exact 600s grace limit) produces 0 late minutes.",
    status: "PASSED",
    durationMs: 3
  },
  {
    id: "TC-04",
    name: "test_late_minutes_grace_boundary_exceeded",
    category: "Business Rules (R1-R5)",
    description: "Punched at 09:40:01 (strictly > 10m) produces 10 late minutes from scheduled shift start.",
    status: "PASSED",
    durationMs: 4
  },
  {
    id: "TC-05",
    name: "test_late_minutes_large_elapsed",
    category: "Business Rules (R1-R5)",
    description: "Punched at 10:15:59 (45m 59s elapsed) produces exactly 45 whole late minutes.",
    status: "PASSED",
    durationMs: 3
  },
  {
    id: "TC-06",
    name: "test_overtime_sub_30_threshold_zero",
    category: "Business Rules (R1-R5)",
    description: "R3: Worked 29 minutes past shift end produces 0 overtime minutes (< 30 min minimum threshold).",
    status: "PASSED",
    durationMs: 4
  },
  {
    id: "TC-07",
    name: "test_overtime_exact_30_threshold",
    category: "Business Rules (R1-R5)",
    description: "R3: Worked exactly 30 minutes past shift end produces 30 overtime minutes.",
    status: "PASSED",
    durationMs: 3
  },
  {
    id: "TC-08",
    name: "test_half_day_flag_below_4_50_hours",
    category: "Business Rules (R1-R5)",
    description: "R5: Work hours 4.49 hrs sets half_day=true; 4.50 hrs sets half_day=false.",
    status: "PASSED",
    durationMs: 4
  },
  {
    id: "TC-09",
    name: "test_overnight_shift_previous_day_attribution",
    category: "Business Rules (R1-R5)",
    description: "R1: Shift 22:00-06:00, punch-in at 01:30 AM IST on May 21 attributed to May 20.",
    status: "PASSED",
    durationMs: 5
  },
  {
    id: "TC-10",
    name: "test_overnight_shift_end_next_day",
    category: "Business Rules (R1-R5)",
    description: "R1: Overnight shift scheduled end in UTC is computed for date + 1 day at shift_end.",
    status: "PASSED",
    durationMs: 4
  },
  {
    id: "TC-11",
    name: "test_create_employee_success",
    category: "Employee CRUD",
    description: "POST /employees creates employee document with server-generated created_at, no _id leaked.",
    status: "PASSED",
    durationMs: 8
  },
  {
    id: "TC-12",
    name: "test_create_duplicate_employee_conflict_409",
    category: "Employee CRUD",
    description: "POST /employees with existing emp_code catches DuplicateKeyError and returns HTTP 409.",
    status: "PASSED",
    durationMs: 6
  },
  {
    id: "TC-13",
    name: "test_create_employee_identical_shifts_rejected_422",
    category: "Employee CRUD",
    description: "POST /employees with shift_start == shift_end raises ValidationError (HTTP 422).",
    status: "PASSED",
    durationMs: 5
  },
  {
    id: "TC-14",
    name: "test_create_employee_impossible_date_rejected_422",
    category: "Employee CRUD",
    description: "POST /employees with impossible date (e.g. 2024-02-31) strictly returns HTTP 422.",
    status: "PASSED",
    durationMs: 4
  },
  {
    id: "TC-15",
    name: "test_list_employees_pagination_and_sorting",
    category: "Employee CRUD",
    description: "GET /employees supports page, page_size (max 100), and sorts ascending by emp_code.",
    status: "PASSED",
    durationMs: 7
  },
  {
    id: "TC-16",
    name: "test_list_employees_department_filter",
    category: "Employee CRUD",
    description: "GET /employees?department=Engineering returns only matching employees with correct total.",
    status: "PASSED",
    durationMs: 6
  },
  {
    id: "TC-17",
    name: "test_punch_in_success_and_initialization",
    category: "Punch Flow & Concurrency",
    description: "POST /attendance/punch-in initializes punch_out=null, work_hours=null, history=[].",
    status: "PASSED",
    durationMs: 9
  },
  {
    id: "TC-18",
    name: "test_punch_in_unknown_employee_404",
    category: "Punch Flow & Concurrency",
    description: "POST /attendance/punch-in for unregistered emp_code returns HTTP 404.",
    status: "PASSED",
    durationMs: 4
  },
  {
    id: "TC-19",
    name: "test_punch_in_boolean_or_float_timestamp_rejected_422",
    category: "Punch Flow & Concurrency",
    description: "Strict epoch ms validation rejects booleans (True) and floats with HTTP 422.",
    status: "PASSED",
    durationMs: 5
  },
  {
    id: "TC-20",
    name: "test_concurrent_punch_in_duplicate_rejected_409",
    category: "Punch Flow & Concurrency",
    description: "Compound unique index (emp_code, date) rejects concurrent duplicate punch-ins with HTTP 409.",
    status: "PASSED",
    durationMs: 8
  },
  {
    id: "TC-21",
    name: "test_punch_out_success_and_metrics_calculation",
    category: "Punch Flow & Concurrency",
    description: "POST /attendance/punch-out updates work_hours, overtime, and half_day atomically.",
    status: "PASSED",
    durationMs: 9
  },
  {
    id: "TC-22",
    name: "test_punch_out_before_punch_in_rejected_422",
    category: "Punch Flow & Concurrency",
    description: "Punch-out timestamp earlier than punch-in instant rejected with HTTP 422.",
    status: "PASSED",
    durationMs: 5
  },
  {
    id: "TC-23",
    name: "test_concurrent_punch_out_race_protection_409",
    category: "Punch Flow & Concurrency",
    description: "Atomic find_one_and_update with punch_out: null filter rejects second concurrent punch-out.",
    status: "PASSED",
    durationMs: 7
  },
  {
    id: "TC-24",
    name: "test_attendance_listing_impossible_dates_and_reversed_range_422",
    category: "Punch Flow & Concurrency",
    description: "GET /attendance rejects impossible calendar dates and reversed date_from > date_to with HTTP 422.",
    status: "PASSED",
    durationMs: 6
  },
  {
    id: "TC-25",
    name: "test_attendance_regularization_audit_history_entry",
    category: "Audit & Regularization",
    description: "PATCH /attendance/{emp_code}/{date} records changes {old, new}, by, reason, and timestamp.",
    status: "PASSED",
    durationMs: 11
  },
  {
    id: "TC-26",
    name: "test_regularization_noop_does_not_append_history",
    category: "Audit & Regularization",
    description: "Submitting regularization request with identical values performs no-op and preserves history.",
    status: "PASSED",
    durationMs: 8
  },
  {
    id: "TC-27",
    name: "test_regularization_chronological_conflict_rejected_422",
    category: "Audit & Regularization",
    description: "Setting punch_out earlier than punch_in during regularization strictly returns HTTP 422.",
    status: "PASSED",
    durationMs: 6
  },
  {
    id: "TC-28",
    name: "test_employee_monthly_prorated_working_days",
    category: "Analytics & Aggregations",
    description: "Mid-month joiners count working days strictly between joined_on and end-of-month.",
    status: "PASSED",
    durationMs: 12
  },
  {
    id: "TC-29",
    name: "test_department_summary_preserves_zero_log_headcount",
    category: "Analytics & Aggregations",
    description: "Employees with 0 logs are preserved in department headcount via preserveNullAndEmptyArrays.",
    status: "PASSED",
    durationMs: 15
  },
  {
    id: "TC-30",
    name: "test_late_leaderboard_dense_window_ranking_ties",
    category: "Analytics & Aggregations",
    description: "Tied employees receive the same rank; subsequent rank is skipped (1, 2, 2, 4) with emp_code tiebreaker.",
    status: "PASSED",
    durationMs: 14
  },
  {
    id: "TC-31",
    name: "test_trend_department_with_no_employees",
    category: "Analytics & Aggregations",
    description: "GET /analytics/departments/{dept}/trend returns empty list [] when department has no employees.",
    status: "PASSED",
    durationMs: 7
  },
  {
    id: "TC-32",
    name: "test_trend_invalid_dates_and_reversed_range",
    category: "Analytics & Aggregations",
    description: "Rejects impossible calendar dates (2024-02-31) and reversed date ranges (date_from > date_to) with HTTP 422.",
    status: "PASSED",
    durationMs: 8
  },
  {
    id: "TC-33",
    name: "test_trend_single_day_range",
    category: "Analytics & Aggregations",
    description: "Single-day range returns exactly 1 row with headcount, present_count, rate, and moving average.",
    status: "PASSED",
    durationMs: 9
  },
  {
    id: "TC-34",
    name: "test_trend_headcount_mid_range_joiner_and_weekends",
    category: "Analytics & Aggregations",
    description: "Calculates daily headcount dynamically as employees join, includes weekends and days without records.",
    status: "PASSED",
    durationMs: 14
  },
  {
    id: "TC-35",
    name: "test_department_trend_gap_filling_and_moving_avg",
    category: "Analytics & Aggregations",
    description: "Every calendar day in range included; 7-day moving average calculated over preceding window.",
    status: "PASSED",
    durationMs: 16
  },
  {
    id: "TC-36",
    name: "test_explain_endpoint_all_five_targets_and_validation",
    category: "MongoDB Indexes & Explain",
    description: "GET /admin/explain validates endpoint names (rejects invalid with 422) and returns executionStats.",
    status: "PASSED",
    durationMs: 12
  }
];

