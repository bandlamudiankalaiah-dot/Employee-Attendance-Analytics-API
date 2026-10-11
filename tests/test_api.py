from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
import pytest
from app.main import (
    IST_TZ,
    round_half_up,
    calculate_late_minutes,
    calculate_work_and_overtime,
    determine_shift_date_and_times,
    epoch_ms_to_utc_dt,
    dt_to_epoch_ms
)

# -------------------------------------------------------------
# Unit Tests: Business Rules & Rounding
# -------------------------------------------------------------

def test_decimal_round_half_up():
    """R4: Contractual Decimal half-up rounding vs Python banker's rounding."""
    # 4.455 with half-up must be 4.46 (Python default round(4.455, 2) is 4.45)
    assert round_half_up(4.455, 2) == 4.46
    assert round_half_up(4.495, 2) == 4.50
    assert round_half_up(4.494, 2) == 4.49

def test_late_minutes_grace_period_boundaries():
    """R2: Grace period: 10 mins. Strictly > 10m is late, calculated from shift start."""
    sched_start_ist = datetime(2024, 5, 20, 9, 30, 0, tzinfo=IST_TZ)
    sched_start_utc = sched_start_ist.astimezone(timezone.utc)
    
    # Exactly on time: 09:30:00 -> 0
    p1 = sched_start_utc
    assert calculate_late_minutes(p1, sched_start_utc) == 0
    
    # Exactly at grace limit: 09:40:00 (600s) -> 0
    p2 = sched_start_utc + timedelta(seconds=600)
    assert calculate_late_minutes(p2, sched_start_utc) == 0
    
    # 1 second past grace: 09:40:01 (601s) -> 10 whole minutes elapsed
    p3 = sched_start_utc + timedelta(seconds=601)
    assert calculate_late_minutes(p3, sched_start_utc) == 10
    
    # 10:15:59 (45m 59s = 2759s) -> 45 minutes
    p4 = sched_start_utc + timedelta(minutes=45, seconds=59)
    assert calculate_late_minutes(p4, sched_start_utc) == 45

def test_overtime_threshold_and_half_day():
    """R3, R4, R5: Overtime >= 30m, work_hours rounding, half_day < 4.50."""
    p_in = datetime(2024, 5, 20, 4, 0, 0, tzinfo=timezone.utc)
    sched_end = datetime(2024, 5, 20, 13, 0, 0, tzinfo=timezone.utc)
    
    # 29 minutes after shift end: OT < 30m -> 0
    p_out_29m = sched_end + timedelta(minutes=29, seconds=59)
    wh, ot, hd = calculate_work_and_overtime(p_in, p_out_29m, sched_end)
    assert ot == 0
    assert hd is False
    
    # Exactly 30 minutes after shift end: OT = 30
    p_out_30m = sched_end + timedelta(minutes=30)
    wh, ot, hd = calculate_work_and_overtime(p_in, p_out_30m, sched_end)
    assert ot == 30
    assert hd is False
    
    # Half-day test: punch out after 4 hours 29 minutes (work_hours < 4.50)
    p_out_short = p_in + timedelta(hours=4, minutes=29)
    wh, ot, hd = calculate_work_and_overtime(p_in, p_out_short, sched_end)
    assert wh < 4.50
    assert hd is True

def test_overnight_shift_date_attribution():
    """R1: Overnight shifts: punch-in before shift_end belongs to previous day."""
    # Shift: 22:00 to 06:00
    # Punch in at 01:30 AM IST on May 21
    p_in_ist = datetime(2024, 5, 21, 1, 30, 0, tzinfo=IST_TZ)
    p_in_utc = p_in_ist.astimezone(timezone.utc)
    
    shift_date, sched_start_utc, sched_end_utc = determine_shift_date_and_times(
        p_in_utc, "22:00", "06:00"
    )
    # Must be attributed to May 20
    assert shift_date == "2024-05-20"
    # Scheduled start is May 20 22:00 IST
    assert sched_start_utc == datetime(2024, 5, 20, 22, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)
    # Scheduled end is May 21 06:00 IST
    assert sched_end_utc == datetime(2024, 5, 21, 6, 0, 0, tzinfo=IST_TZ).astimezone(timezone.utc)

# -------------------------------------------------------------
# Integration Tests: Employee Endpoints
# -------------------------------------------------------------

def test_create_employee_success(client):
    payload = {
        "emp_code": "TEST01",
        "name": "Test User",
        "email": "test@example.com",
        "department": "Engineering",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "joined_on": "2024-01-15"
    }
    res = client.post("/employees", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["emp_code"] == "TEST01"
    assert "_id" not in data
    assert "created_at" in data

def test_create_duplicate_employee_conflict(client):
    payload = {
        "emp_code": "TEST_DUP",
        "name": "Test User",
        "email": "dup@example.com",
        "department": "Engineering",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "joined_on": "2024-01-15"
    }
    res1 = client.post("/employees", json=payload)
    assert res1.status_code == 201
    
    # Second create with same emp_code must return 409
    res2 = client.post("/employees", json=payload)
    assert res2.status_code == 409

def test_create_employee_identical_shifts_rejected(client):
    payload = {
        "emp_code": "TEST_BAD",
        "name": "Test User",
        "email": "bad@example.com",
        "department": "Engineering",
        "shift_start": "09:00",
        "shift_end": "09:00",  # Identical
        "joined_on": "2024-01-15"
    }
    res = client.post("/employees", json=payload)
    assert res.status_code == 422

def test_create_employee_impossible_date_rejected(client):
    payload = {
        "emp_code": "TEST_LEAP",
        "name": "Test User",
        "email": "leap@example.com",
        "department": "Engineering",
        "shift_start": "09:00",
        "shift_end": "18:00",
        "joined_on": "2024-02-31"  # Impossible date
    }
    res = client.post("/employees", json=payload)
    assert res.status_code == 422

def test_list_employees_pagination_and_filter(client):
    for i, dept in [(1, "HR"), (2, "HR"), (3, "Finance")]:
        client.post("/employees", json={
            "emp_code": f"EMP_L_{i}",
            "name": f"User {i}",
            "email": f"user{i}@company.com",
            "department": dept,
            "shift_start": "09:00",
            "shift_end": "18:00",
            "joined_on": "2024-01-01"
        })
        
    res_hr = client.get("/employees?department=HR")
    assert res_hr.status_code == 200
    hr_data = res_hr.json()
    assert hr_data["total"] == 2
    assert len(hr_data["items"]) == 2
    assert all(it["department"] == "HR" for it in hr_data["items"])
    
    res_page = client.get("/employees?page=1&page_size=1")
    assert res_page.status_code == 200
    page_data = res_page.json()
    assert len(page_data["items"]) == 1
    assert page_data["page_size"] == 1
    assert page_data["total"] >= 3

# -------------------------------------------------------------
# Integration Tests: Attendance Punch-in & Punch-out
# -------------------------------------------------------------

def test_punch_in_and_punch_out_flow(client):
    client.post("/employees", json={
        "emp_code": "PUNCH_EMP",
        "name": "Punch Tester",
        "email": "punch@company.com",
        "department": "Engineering",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "joined_on": "2024-01-01"
    })
    
    p_in_ms = 1716177600000
    res_in = client.post("/attendance/punch-in", json={
        "emp_code": "PUNCH_EMP",
        "punched_at": p_in_ms,
        "status": "PRESENT"
    })
    assert res_in.status_code == 201
    in_data = res_in.json()
    assert in_data["date"] == "2024-05-20"
    assert in_data["late_minutes"] == 0
    assert in_data["punch_out"] is None
    assert in_data["half_day"] is False
    assert in_data["history"] == []
    
    # Duplicate punch in on same day -> 409 Conflict
    res_dup = client.post("/attendance/punch-in", json={
        "emp_code": "PUNCH_EMP",
        "punched_at": p_in_ms + 60000
    })
    assert res_dup.status_code == 409
    
    p_out_ms = 1716212700000
    res_out = client.post("/attendance/punch-out", json={
        "emp_code": "PUNCH_EMP",
        "punched_at": p_out_ms
    })
    assert res_out.status_code == 200
    out_data = res_out.json()
    assert out_data["work_hours"] == 9.75
    assert out_data["overtime_minutes"] == 45
    assert out_data["half_day"] is False
    
    # Double punch out -> 404 or 409
    res_out_dup = client.post("/attendance/punch-out", json={
        "emp_code": "PUNCH_EMP",
        "punched_at": p_out_ms + 10000
    })
    assert res_out_dup.status_code in [404, 409]

def test_punch_in_boolean_timestamp_rejected(client):
    client.post("/employees", json={
        "emp_code": "BOOL_EMP",
        "name": "Bool Tester",
        "email": "bool@company.com",
        "department": "Engineering",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "joined_on": "2024-01-01"
    })
    res = client.post("/attendance/punch-in", json={
        "emp_code": "BOOL_EMP",
        "punched_at": True  # Boolean must be rejected
    })
    assert res.status_code == 422

def test_punch_in_float_timestamp_rejected(client):
    res = client.post("/attendance/punch-in", json={
        "emp_code": "BOOL_EMP",
        "punched_at": 1716177600000.55  # Float must be rejected
    })
    assert res.status_code == 422

def test_attendance_listing_date_validations(client):
    # Invalid calendar date
    res1 = client.get("/attendance?date_from=2024-02-31")
    assert res1.status_code == 422
    
    # Reversed date range
    res2 = client.get("/attendance?date_from=2024-05-20&date_to=2024-05-10")
    assert res2.status_code == 422

# -------------------------------------------------------------
# Integration Tests: Attendance Regularization & Audit
# -------------------------------------------------------------

def test_attendance_regularization_audit_history(client):
    client.post("/employees", json={
        "emp_code": "REG_EMP",
        "name": "Reg User",
        "email": "reg@company.com",
        "department": "Engineering",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "joined_on": "2024-01-01"
    })
    
    client.post("/attendance/punch-in", json={
        "emp_code": "REG_EMP",
        "punched_at": 1716177600000,
        "status": "PRESENT"
    })
    
    patch_res = client.patch("/attendance/REG_EMP/2024-05-20", json={
        "regularized_by": "manager_alice",
        "reason": "Approved remote work",
        "status": "WFH"
    })
    assert patch_res.status_code == 200
    updated = patch_res.json()
    assert updated["status"] == "WFH"
    assert len(updated["history"]) == 1
    h_entry = updated["history"][0]
    assert h_entry["by"] == "manager_alice"
    assert h_entry["reason"] == "Approved remote work"
    assert h_entry["changes"]["status"]["old"] == "PRESENT"
    assert h_entry["changes"]["status"]["new"] == "WFH"

def test_regularization_noop_does_not_append_history(client):
    client.post("/employees", json={
        "emp_code": "REG_NOOP",
        "name": "Reg Noop User",
        "email": "regnoop@company.com",
        "department": "Engineering",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "joined_on": "2024-01-01"
    })
    client.post("/attendance/punch-in", json={
        "emp_code": "REG_NOOP",
        "punched_at": 1716177600000,
        "status": "PRESENT"
    })
    # First regularization to WFH
    patch1 = client.patch("/attendance/REG_NOOP/2024-05-20", json={
        "regularized_by": "manager_alice",
        "reason": "Remote work approval",
        "status": "WFH"
    })
    assert patch1.status_code == 200
    assert len(patch1.json()["history"]) == 1

    # Second identical regularization (noop)
    patch2 = client.patch("/attendance/REG_NOOP/2024-05-20", json={
        "regularized_by": "manager_alice",
        "reason": "Redundant click",
        "status": "WFH"
    })
    assert patch2.status_code == 200
    updated = patch2.json()
    # History length should remain 1
    assert len(updated["history"]) == 1

def test_regularization_chronological_conflict_rejected(client):
    client.post("/employees", json={
        "emp_code": "REG_CONFLICT",
        "name": "Reg Conflict User",
        "email": "regconflict@company.com",
        "department": "Engineering",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "joined_on": "2024-01-01"
    })
    client.post("/attendance/punch-in", json={
        "emp_code": "REG_CONFLICT",
        "punched_at": 1716177600000,
        "status": "PRESENT"
    })
    patch_res = client.patch("/attendance/REG_CONFLICT/2024-05-20", json={
        "regularized_by": "manager_alice",
        "reason": "Bad punch times",
        "punch_in": 1716212700000,
        "punch_out": 1716177600000  # punch_out < punch_in
    })
    assert patch_res.status_code == 422

# -------------------------------------------------------------
# Integration Tests: Analytics Endpoints
# -------------------------------------------------------------

def test_employee_monthly_analytics_prorated_and_weekend(client):
    client.post("/employees", json={
        "emp_code": "ANALYTICS_EMP",
        "name": "Monthly Analytics User",
        "email": "monthly@company.com",
        "department": "Engineering",
        "shift_start": "09:30",
        "shift_end": "18:30",
        "joined_on": "2024-05-15"
    })
    
    res = client.get("/analytics/employees/ANALYTICS_EMP/monthly?month=2024-05")
    assert res.status_code == 200
    data = res.json()
    assert data["total_working_days"] > 0
    assert data["present_days"] == 0
    assert data["attendance_rate"] == 0.0

def test_admin_explain_endpoints(client):
    # Valid endpoints
    res1 = client.get("/admin/explain/attendance_list")
    assert res1.status_code == 200
    
    res2 = client.get("/admin/explain/employee_monthly")
    assert res2.status_code == 200
    
    # Invalid endpoint name -> 422
    res_inv = client.get("/admin/explain/unknown_nonexistent")
    assert res_inv.status_code == 422

def test_health_endpoint(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["mongo_connected"] is True

# -------------------------------------------------------------
# Integration Tests: Department Attendance Trend
# -------------------------------------------------------------

def test_trend_department_with_no_employees(client):
    res = client.get("/analytics/departments/GhostDepartment/trend?date_from=2024-05-01&date_to=2024-05-07")
    assert res.status_code == 200
    assert res.json() == []

def test_trend_invalid_dates_and_reversed_range(client):
    # Impossible date
    res1 = client.get("/analytics/departments/Engineering/trend?date_from=2024-02-31&date_to=2024-03-05")
    assert res1.status_code == 422
    
    # Reversed range
    res2 = client.get("/analytics/departments/Engineering/trend?date_from=2024-05-10&date_to=2024-05-05")
    assert res2.status_code == 422

def test_trend_single_day_range(client):
    client.post("/employees", json={
        "emp_code": "TREND_SINGLE",
        "name": "Single Trend User",
        "email": "single@company.com",
        "department": "QA",
        "shift_start": "09:00",
        "shift_end": "18:00",
        "joined_on": "2024-05-01"
    })
    
    res = client.get("/analytics/departments/QA/trend?date_from=2024-05-01&date_to=2024-05-01")
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    row = items[0]
    assert row["date"] == "2024-05-01"
    assert row["headcount"] == 1
    assert "present_count" in row
    assert "attendance_rate" in row
    assert "seven_day_moving_avg" in row

def test_trend_headcount_mid_range_joiner_and_weekends(client):
    dept = "TrendDept"
    # EMP_A joined on May 01
    client.post("/employees", json={
        "emp_code": "TREND_A",
        "name": "User A",
        "email": "a@company.com",
        "department": dept,
        "shift_start": "09:00",
        "shift_end": "18:00",
        "joined_on": "2024-05-01"
    })
    # EMP_B joins on May 04 (in the middle of the range)
    client.post("/employees", json={
        "emp_code": "TREND_B",
        "name": "User B",
        "email": "b@company.com",
        "department": dept,
        "shift_start": "09:00",
        "shift_end": "18:00",
        "joined_on": "2024-05-04"
    })
    
    # Attendance for User A on May 01 (present) and May 02 (half day)
    client.post("/attendance/punch-in", json={
        "emp_code": "TREND_A",
        "punched_at": 1714534200000, # 2024-05-01 09:00 IST
        "status": "PRESENT"
    })
    # Regularize May 02 to half-day
    client.post("/attendance/punch-in", json={
        "emp_code": "TREND_A",
        "punched_at": 1714620600000, # 2024-05-02
        "status": "PRESENT"
    })
    client.patch("/attendance/TREND_A/2024-05-02", json={
        "regularized_by": "lead",
        "reason": "Half day morning",
        "status": "PRESENT",
        "punch_out": 1714633200000 # 3.5 hrs -> half day = true
    })
    
    res = client.get(f"/analytics/departments/{dept}/trend?date_from=2024-05-01&date_to=2024-05-07")
    assert res.status_code == 200
    rows = res.json()
    # Must have exactly 7 rows (one per calendar day, including weekends May 4-5)
    assert len(rows) == 7
    
    date_map = {r["date"]: r for r in rows}
    # May 01: Headcount 1, present 1.0 (or in progress)
    assert date_map["2024-05-01"]["headcount"] == 1
    # May 02: Half-day present_count = 0.5
    assert date_map["2024-05-02"]["headcount"] == 1
    assert date_map["2024-05-02"]["present_count"] == 0.5
    assert date_map["2024-05-02"]["attendance_rate"] == 50.0
    
    # May 03: No attendance -> present_count = 0.0, rate = 0.0
    assert date_map["2024-05-03"]["headcount"] == 1
    assert date_map["2024-05-03"]["present_count"] == 0.0
    assert date_map["2024-05-03"]["attendance_rate"] == 0.0
    
    # May 04 (User B joined): Headcount becomes 2
    assert date_map["2024-05-04"]["headcount"] == 2
    # May 05 (Sunday): Headcount remains 2, present_count 0.0
    assert date_map["2024-05-05"]["headcount"] == 2
    assert date_map["2024-05-05"]["present_count"] == 0.0
    
    # Verify moving average is present and properly rounded
    for r in rows:
        assert isinstance(r["seven_day_moving_avg"], (int, float))
        assert r["seven_day_moving_avg"] >= 0.0

def test_department_trend_pipeline_structure():
    from app.main import build_department_trend_pipeline, build_compatible_department_trend_pipeline
    pipe = build_department_trend_pipeline("Engineering", "2024-05-01", "2024-05-07")
    stage_names = [list(stage.keys())[0] for stage in pipe]
    assert "$match" in stage_names
    assert "$lookup" in stage_names
    assert "$setWindowFields" in stage_names
    assert "$project" in stage_names

    compat_pipe = build_compatible_department_trend_pipeline(
        "Engineering", "2024-05-01", "2024-05-07", ["2024-05-01", "2024-05-02"]
    )
    compat_stages = [list(stage.keys())[0] for stage in compat_pipe]
    assert "$match" in compat_stages
    assert "$lookup" in compat_stages
    assert "$group" in compat_stages


# -------------------------------------------------------------
# Regression Tests for All Confirmed Defects
# -------------------------------------------------------------

def test_concurrent_duplicate_punch_in(client):
    from concurrent.futures import ThreadPoolExecutor
    client.post("/employees", json={
        "emp_code": "CONCURR_IN",
        "name": "Concurrent In",
        "email": "concur_in@company.com",
        "department": "Engineering",
        "shift_start": "09:00",
        "shift_end": "18:00",
        "joined_on": "2024-01-01"
    })
    
    payload = {
        "emp_code": "CONCURR_IN",
        "punched_at": 1716177600000,
        "status": "PRESENT"
    }
    
    def do_punch():
        return client.post("/attendance/punch-in", json=payload)
        
    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(do_punch)
        f2 = executor.submit(do_punch)
        r1, r2 = f1.result(), f2.result()
        
    status_codes = sorted([r1.status_code, r2.status_code])
    assert status_codes == [201, 409]

def test_concurrent_duplicate_punch_out(client):
    from concurrent.futures import ThreadPoolExecutor
    client.post("/employees", json={
        "emp_code": "CONCURR_OUT",
        "name": "Concurrent Out",
        "email": "concur_out@company.com",
        "department": "Engineering",
        "shift_start": "09:00",
        "shift_end": "18:00",
        "joined_on": "2024-01-01"
    })
    client.post("/attendance/punch-in", json={
        "emp_code": "CONCURR_OUT",
        "punched_at": 1716177600000,
        "status": "PRESENT"
    })
    
    payload = {
        "emp_code": "CONCURR_OUT",
        "punched_at": 1716210000000
    }
    
    def do_punch_out():
        return client.post("/attendance/punch-out", json=payload)
        
    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(do_punch_out)
        f2 = executor.submit(do_punch_out)
        r1, r2 = f1.result(), f2.result()
        
    status_codes = sorted([r1.status_code, r2.status_code])
    assert status_codes == [200, 409]

def test_punch_out_does_not_select_old_incomplete_records(client):
    client.post("/employees", json={
        "emp_code": "OLD_RECORD_EMP",
        "name": "Old Record",
        "email": "oldrec@company.com",
        "department": "Engineering",
        "shift_start": "09:00",
        "shift_end": "18:00",
        "joined_on": "2024-01-01"
    })
    # Punch in on 2024-05-01 (1714534200000 is 2024-05-01 09:00 IST)
    r_in = client.post("/attendance/punch-in", json={
        "emp_code": "OLD_RECORD_EMP",
        "punched_at": 1714534200000,
        "status": "PRESENT"
    })
    assert r_in.status_code == 201
    
    # 10 days later on 2024-05-11, punch out without punching in on 2024-05-11
    # 1715430600000 is 2024-05-11 18:00 IST
    r_out = client.post("/attendance/punch-out", json={
        "emp_code": "OLD_RECORD_EMP",
        "punched_at": 1715430600000
    })
    # Must NOT select the 10-day old punch-in record!
    assert r_out.status_code == 404
    
    # Verify the 2024-05-01 record still has punch_out: None
    att = client.get("/attendance?emp_code=OLD_RECORD_EMP").json()
    assert att["items"][0]["date"] == "2024-05-01"
    assert att["items"][0]["punch_out"] is None

def test_late_leaderboard_ranking_ties_and_cutoff(client):
    dept = "TieDept"
    for i, code in enumerate(["LEAD_A", "LEAD_B", "LEAD_C", "LEAD_D"]):
        client.post("/employees", json={
            "emp_code": code,
            "name": f"User {code}",
            "email": f"{code.lower()}@company.com",
            "department": dept,
            "shift_start": "09:00",
            "shift_end": "18:00",
            "joined_on": "2024-01-01"
        })
        
    # LEAD_A: 60 mins late
    # LEAD_B: 40 mins late
    # LEAD_C: 40 mins late (tied with B)
    # LEAD_D: 20 mins late
    client.post("/attendance/punch-in", json={
        "emp_code": "LEAD_A",
        "punched_at": 1714537800000, # 60 min late
        "status": "PRESENT"
    })
    client.post("/attendance/punch-in", json={
        "emp_code": "LEAD_B",
        "punched_at": 1714536600000, # 40 min late
        "status": "PRESENT"
    })
    client.post("/attendance/punch-in", json={
        "emp_code": "LEAD_C",
        "punched_at": 1714536600000, # 40 min late
        "status": "PRESENT"
    })
    client.post("/attendance/punch-in", json={
        "emp_code": "LEAD_D",
        "punched_at": 1714535400000, # 20 min late
        "status": "PRESENT"
    })
    
    # Query with limit=3
    res_cutoff = client.get(f"/analytics/leaderboard/late?month=2024-05&department={dept}&limit=3")
    assert res_cutoff.status_code == 200
    rows = res_cutoff.json()
    assert len(rows) == 3
    assert rows[0]["emp_code"] == "LEAD_A" and rows[0]["rank"] == 1
    assert rows[1]["emp_code"] == "LEAD_B" and rows[1]["rank"] == 2
    assert rows[2]["emp_code"] == "LEAD_C" and rows[2]["rank"] == 2
    
    # Query all 4 to check rank 4 (rank 3 skipped due to tie)
    res_all = client.get(f"/analytics/leaderboard/late?month=2024-05&department={dept}&limit=10")
    assert res_all.status_code == 200
    rows_all = res_all.json()
    assert len(rows_all) == 4
    assert rows_all[3]["emp_code"] == "LEAD_D" and rows_all[3]["rank"] == 4

def test_department_monthly_summary_aggregation(client):
    dept = "AnalyticsDept"
    # User 1 joined beginning of month
    client.post("/employees", json={
        "emp_code": "DEPT_EMP1",
        "name": "Dept Emp 1",
        "email": "d1@company.com",
        "department": dept,
        "shift_start": "09:00",
        "shift_end": "18:00",
        "joined_on": "2024-05-01"
    })
    # User 2 joined mid month (2024-05-15)
    client.post("/employees", json={
        "emp_code": "DEPT_EMP2",
        "name": "Dept Emp 2",
        "email": "d2@company.com",
        "department": dept,
        "shift_start": "09:00",
        "shift_end": "18:00",
        "joined_on": "2024-05-15"
    })
    # User in other department with ZERO attendance logs
    client.post("/employees", json={
        "emp_code": "ZERO_LOG_EMP",
        "name": "Zero Logs",
        "email": "zlog@company.com",
        "department": "EmptyLogsDept",
        "shift_start": "09:00",
        "shift_end": "18:00",
        "joined_on": "2024-05-01"
    })
    
    # Punch in for DEPT_EMP1 on May 1st (Full day present)
    client.post("/attendance/punch-in", json={
        "emp_code": "DEPT_EMP1",
        "punched_at": 1714534200000,
        "status": "PRESENT"
    })
    # Punch in for DEPT_EMP1 on May 2nd (Half day regularized)
    client.post("/attendance/punch-in", json={
        "emp_code": "DEPT_EMP1",
        "punched_at": 1714620600000,
        "status": "PRESENT"
    })
    client.patch("/attendance/DEPT_EMP1/2024-05-02", json={
        "regularized_by": "admin",
        "reason": "Half day morning",
        "status": "PRESENT",
        "punch_out": 1714633200000
    })
    
    res = client.get("/analytics/departments/summary?month=2024-05")
    assert res.status_code == 200
    summaries = {s["department"]: s for s in res.json()}
    
    assert dept in summaries
    assert summaries[dept]["headcount"] == 2
    assert summaries[dept]["total_present_days"] == 1.5
    assert summaries[dept]["avg_attendance_rate"] > 0.0
    
    # EmptyLogsDept has 1 headcount and 0.0 present days
    assert "EmptyLogsDept" in summaries
    assert summaries["EmptyLogsDept"]["headcount"] == 1
    assert summaries["EmptyLogsDept"]["total_present_days"] == 0.0
    assert summaries["EmptyLogsDept"]["avg_attendance_rate"] == 0.0

def test_admin_explain_failure_handling(client, monkeypatch):
    # Invalid endpoint name returns 422
    res_inv = client.get("/admin/explain/unknown_endpoint")
    assert res_inv.status_code == 422
    
    # Genuine explain failure returns 500 without pretending IXSCAN
    import app.main as app_module
    def fail_command(*args, **kwargs):
        raise RuntimeError("Forced explain error")
        
    database = app_module.get_db()
    monkeypatch.setattr(database, "command", fail_command)
    
    res_err = client.get("/admin/explain/attendance_list")
    assert res_err.status_code == 500
    assert "MongoDB explain failed" in res_err.json()["detail"]

def test_startup_readiness_failure(client, monkeypatch):
    import app.main as app_module
    # Simulate DB not ready
    monkeypatch.setattr(app_module, "is_db_ready", False)
    monkeypatch.setattr(app_module, "db_init_error", "Mock index creation failed")
    
    res = client.get("/health")
    assert res.status_code == 503
    assert "Mock index creation failed" in res.json()["detail"]

def test_cors_configuration_safe(client):
    from app.main import app, ALLOWED_ORIGINS
    from starlette.middleware.cors import CORSMiddleware
    cors_mw = None
    for mw in app.user_middleware:
        if mw.cls == CORSMiddleware:
            cors_mw = mw
            break
    assert cors_mw is not None
    # Verify origins are explicit and not wildcard "*" with allow_credentials
    origins = cors_mw.kwargs.get("allow_origins", [])
    assert "*" not in origins
    assert cors_mw.kwargs.get("allow_credentials") is True
    assert set(origins) == set(ALLOWED_ORIGINS)

    # Allowed origin preflight
    res_ok = client.options("/health", headers={
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "GET"
    })
    assert res_ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert res_ok.headers.get("access-control-allow-credentials") == "true"

    # Disallowed origin preflight
    res_bad = client.options("/health", headers={
        "Origin": "http://unauthorized-domain.com",
        "Access-Control-Request-Method": "GET"
    })
    assert "access-control-allow-origin" not in res_bad.headers


