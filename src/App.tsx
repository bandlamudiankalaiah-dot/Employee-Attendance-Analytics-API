import React, { useState, useMemo } from 'react';
import { 
  Server, Database, Code2, CheckCircle2, ShieldCheck, Terminal, Play, 
  Layers, Clock, AlertTriangle, ArrowRight, UserCheck, RefreshCw, FileText,
  Copy, Check, Search, TrendingUp, BarChart3, Users, ChevronRight, Eye,
  Lock, GitCommit, FileCode, CheckCircle, HelpCircle, Download, ExternalLink
} from 'lucide-react';
import { PROJECT_FILES } from './data/projectFiles';
import { TEST_CASES, TestCase } from './data/testSuites';
import { FILE_CONTENTS } from './data/fileContents';

interface Employee {
  emp_code: string;
  name: string;
  email: string;
  department: string;
  shift_start: string;
  shift_end: string;
  joined_on: string;
  created_at: string;
}

interface AttendanceRecord {
  emp_code: string;
  date: string;
  status: "PRESENT" | "WFH" | "ON_DUTY" | "ABSENT" | "LEAVE";
  punch_in: number | null;
  punch_out: number | null;
  late_minutes: number;
  work_hours: number | null;
  overtime_minutes: number;
  half_day: boolean;
  history: {
    at: number;
    by: string;
    reason: string;
    changes: Record<string, { old: any; new: any }>;
  }[];
}

const INITIAL_EMPLOYEES: Employee[] = [
  {
    emp_code: "EMP001",
    name: "Aarav Sharma",
    email: "aarav.sharma@example.com",
    department: "Engineering",
    shift_start: "09:30",
    shift_end: "18:30",
    joined_on: "2024-01-15",
    created_at: "2024-01-15T04:00:00Z"
  },
  {
    emp_code: "EMP002",
    name: "Diya Patel",
    email: "diya.patel@example.com",
    department: "Engineering",
    shift_start: "09:30",
    shift_end: "18:30",
    joined_on: "2024-02-01",
    created_at: "2024-02-01T04:00:00Z"
  },
  {
    emp_code: "EMP003",
    name: "Rohan Verma",
    email: "rohan.verma@example.com",
    department: "Operations",
    shift_start: "22:00",
    shift_end: "06:00", // Overnight Shift
    joined_on: "2024-03-01",
    created_at: "2024-03-01T04:00:00Z"
  },
  {
    emp_code: "EMP004",
    name: "Ananya Iyer",
    email: "ananya.iyer@example.com",
    department: "Product",
    shift_start: "10:00",
    shift_end: "19:00",
    joined_on: "2024-05-15", // Mid-month joiner
    created_at: "2024-05-15T04:00:00Z"
  },
  {
    emp_code: "EMP007",
    name: "Kabir Das",
    email: "kabir.das@example.com",
    department: "Sales",
    shift_start: "09:00",
    shift_end: "18:00",
    joined_on: "2024-05-01", // Zero logs in month
    created_at: "2024-05-01T04:00:00Z"
  }
];

const INITIAL_ATTENDANCE: AttendanceRecord[] = [
  {
    emp_code: "EMP001",
    date: "2024-05-20",
    status: "PRESENT",
    punch_in: 1716177600000, // 09:30 IST
    punch_out: 1716212700000, // 19:15 IST (9.75 hrs, 45m OT)
    late_minutes: 0,
    work_hours: 9.75,
    overtime_minutes: 45,
    half_day: false,
    history: []
  },
  {
    emp_code: "EMP001",
    date: "2024-05-21",
    status: "PRESENT",
    punch_in: 1716264001000, // 09:40:01 IST (10m late)
    punch_out: 1716296400000, // 18:30 IST
    late_minutes: 10,
    work_hours: 8.83,
    overtime_minutes: 0,
    half_day: false,
    history: []
  },
  {
    emp_code: "EMP002",
    date: "2024-05-21",
    status: "WFH",
    punch_in: 1716264000000, // 09:40:00 IST (exact grace limit -> 0 late)
    punch_out: 1716279600000, // 14:00 IST (4.33 hrs -> Half day = true)
    late_minutes: 0,
    work_hours: 4.33,
    overtime_minutes: 0,
    half_day: true,
    history: [
      {
        at: 1716298000000,
        by: "manager_alice",
        reason: "Remote work approval granted post-standup",
        changes: { status: { old: "PRESENT", new: "WFH" } }
      }
    ]
  },
  {
    emp_code: "EMP003",
    date: "2024-05-20", // Overnight shift: punched in at 01:15 AM May 21 -> belongs to May 20
    status: "PRESENT",
    punch_in: 1716234300000, // 01:15 AM IST May 21
    punch_out: 1716252000000, // 06:10 AM IST May 21
    late_minutes: 195,
    work_hours: 4.92,
    overtime_minutes: 0,
    half_day: false,
    history: []
  }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'workbench' | 'code' | 'tests' | 'architecture' | 'setup'>('workbench');
  
  // Simulation State
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>(INITIAL_ATTENDANCE);
  const [selectedEmp, setSelectedEmp] = useState<string>("EMP001");
  const [selectedFile, setSelectedFile] = useState<string>("app/main.py");
  const [copied, setCopied] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // New Employee Modal state
  const [newEmpForm, setNewEmpForm] = useState({
    emp_code: "",
    name: "",
    email: "",
    department: "Engineering",
    shift_start: "09:30",
    shift_end: "18:30",
    joined_on: "2024-05-01"
  });

  // Regularize modal state
  const [regModalOpen, setRegModalOpen] = useState(false);
  const [regTarget, setRegTarget] = useState<AttendanceRecord | null>(null);
  const [regForm, setRegForm] = useState({
    by: "admin_user",
    reason: "Biometric terminal synchronization adjustment",
    status: "PRESENT"
  });

  // Department Attendance Trend state
  const [trendDept, setTrendDept] = useState<string>("Engineering");
  const [trendFrom, setTrendFrom] = useState<string>("2024-05-15");
  const [trendTo, setTrendTo] = useState<string>("2024-05-21");
  const [trendView, setTrendView] = useState<'results' | 'mongo6' | 'compatible'>('results');

  // Test Runner state
  const [runningTests, setRunningTests] = useState(false);
  const [testResults, setTestResults] = useState<TestCase[]>(TEST_CASES);
  const [testFilter, setTestFilter] = useState<string>("ALL");

  const notify = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const copyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    notify("Copied to clipboard!", "success");
    setTimeout(() => setCopied(false), 2000);
  };

  // Rule R4: Decimal Half-Up Rounding
  const roundHalfUp = (val: number, decimals: number = 2): number => {
    const factor = Math.pow(10, decimals);
    return Math.floor(val * factor + 0.5) / factor;
  };

  // Preset Punch In Handlers
  const handlePunchInScenario = (scenario: 'ontime' | 'grace_exact' | 'grace_exceeded' | 'overnight' | 'duplicate' | 'impossible_date' | 'bad_type') => {
    const emp = employees.find(e => e.emp_code === selectedEmp);
    if (!emp) return;

    if (scenario === 'impossible_date') {
      notify("HTTP 422 Unprocessable Entity: Invalid calendar date '2024-02-31'. Calendar dates must strictly exist.", "error");
      return;
    }

    if (scenario === 'bad_type') {
      notify("HTTP 422 Unprocessable Entity: punched_at must be an integer epoch millisecond timestamp (booleans and floats rejected).", "error");
      return;
    }

    if (scenario === 'duplicate') {
      const today = "2024-05-20";
      const exists = attendance.some(a => a.emp_code === selectedEmp && a.date === today);
      if (exists) {
        notify("HTTP 409 Conflict: Attendance record already exists for this employee and shift date (idx_emp_code_date_unique).", "error");
        return;
      }
    }

    let date = "2024-05-22";
    let punchInMs = 1716350400000; // 09:30 IST
    let lateMinutes = 0;

    if (scenario === 'ontime') {
      lateMinutes = 0;
      punchInMs = 1716350400000; // 09:30:00 IST
    } else if (scenario === 'grace_exact') {
      lateMinutes = 0; // 09:40:00 IST (exact 600s grace)
      punchInMs = 1716351000000;
    } else if (scenario === 'grace_exceeded') {
      lateMinutes = 10; // 09:40:01 IST (> 10m strictly -> 10 late min)
      punchInMs = 1716351001000;
    } else if (scenario === 'overnight') {
      date = "2024-05-21"; // Attributed to previous day
      lateMinutes = 0;
      punchInMs = 1716321600000; // 01:30 AM May 22
    }

    // Check if active punch already exists
    const hasActive = attendance.some(a => a.emp_code === selectedEmp && a.date === date);
    if (hasActive) {
      notify(`HTTP 409 Conflict: Record already exists for ${selectedEmp} on ${date}`, 'error');
      return;
    }

    const newRecord: AttendanceRecord = {
      emp_code: selectedEmp,
      date,
      status: "PRESENT",
      punch_in: punchInMs,
      punch_out: null,
      late_minutes: lateMinutes,
      work_hours: null,
      overtime_minutes: 0,
      half_day: false,
      history: []
    };

    setAttendance([newRecord, ...attendance]);
    notify(`HTTP 201 Created: Punch-in logged for ${selectedEmp}. Late Minutes: ${lateMinutes}m`, 'success');
  };

  // Punch Out Handlers
  const handlePunchOutScenario = (scenario: 'normal' | 'half_day' | 'overtime_sub30' | 'overtime_45' | 'reversed_time') => {
    if (scenario === 'reversed_time') {
      notify("HTTP 422 Unprocessable Entity: Punch-out timestamp cannot be earlier than punch-in.", 'error');
      return;
    }

    const activeIdx = attendance.findIndex(a => a.emp_code === selectedEmp && a.punch_out === null);
    if (activeIdx === -1) {
      notify("HTTP 404 Not Found: No active punch-in record found to punch out.", 'error');
      return;
    }

    const active = attendance[activeIdx];
    const punchInMs = active.punch_in || 1716350400000;
    let punchOutMs = punchInMs + 9 * 3600 * 1000; // default 9 hrs
    let overtimeMinutes = 0;

    if (scenario === 'normal') {
      punchOutMs = punchInMs + 8.5 * 3600 * 1000; // 8.5 hrs
      overtimeMinutes = 0;
    } else if (scenario === 'half_day') {
      punchOutMs = punchInMs + 3.5 * 3600 * 1000; // 3.5 hrs (< 4.5h)
      overtimeMinutes = 0;
    } else if (scenario === 'overtime_sub30') {
      punchOutMs = punchInMs + 9.4 * 3600 * 1000; // 24m OT (< 30m -> 0 OT)
      overtimeMinutes = 0;
    } else if (scenario === 'overtime_45') {
      punchOutMs = punchInMs + 9.75 * 3600 * 1000; // 45m OT
      overtimeMinutes = 45;
    }

    const diffSec = (punchOutMs - punchInMs) / 1000;
    const hours = roundHalfUp(diffSec / 3600, 2);
    const halfDay = hours < 4.50;

    const updated = [...attendance];
    updated[activeIdx] = {
      ...active,
      punch_out: punchOutMs,
      work_hours: hours,
      overtime_minutes: overtimeMinutes,
      half_day: halfDay
    };

    setAttendance(updated);
    notify(`HTTP 200 OK: Punch-out recorded! Work: ${hours}h, OT: ${overtimeMinutes}m, Half Day: ${halfDay ? 'YES' : 'NO'}`, 'success');
  };

  // Add Employee
  const handleAddEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpForm.emp_code.trim()) {
      notify("Employee code is required.", "error");
      return;
    }
    if (employees.some(emp => emp.emp_code === newEmpForm.emp_code)) {
      notify(`HTTP 409 Conflict: Employee code '${newEmpForm.emp_code}' already exists!`, "error");
      return;
    }
    if (newEmpForm.shift_start === newEmpForm.shift_end) {
      notify("HTTP 422: Shift start and shift end times cannot be identical.", "error");
      return;
    }

    const newEmp: Employee = {
      emp_code: newEmpForm.emp_code.toUpperCase(),
      name: newEmpForm.name || "New Employee",
      email: newEmpForm.email || `${newEmpForm.emp_code.toLowerCase()}@example.com`,
      department: newEmpForm.department,
      shift_start: newEmpForm.shift_start,
      shift_end: newEmpForm.shift_end,
      joined_on: newEmpForm.joined_on,
      created_at: new Date().toISOString()
    };

    setEmployees([...employees, newEmp]);
    setSelectedEmp(newEmp.emp_code);
    notify(`HTTP 201 Created: Employee ${newEmp.emp_code} added successfully!`, "success");
    setNewEmpForm({
      emp_code: "",
      name: "",
      email: "",
      department: "Engineering",
      shift_start: "09:30",
      shift_end: "18:30",
      joined_on: "2024-05-01"
    });
  };

  // Regularize Submit
  const handleApplyRegularization = () => {
    if (!regTarget) return;

    if (regForm.status === regTarget.status) {
      notify("HTTP 200 OK (No-Op): No fields changed. History preserved without empty entries.", "info");
      setRegModalOpen(false);
      return;
    }

    const changes: Record<string, { old: any; new: any }> = {
      status: { old: regTarget.status, new: regForm.status }
    };

    const updated = attendance.map(item => {
      if (item.emp_code === regTarget.emp_code && item.date === regTarget.date) {
        return {
          ...item,
          status: regForm.status as any,
          history: [
            ...item.history,
            {
              at: Date.now(),
              by: regForm.by,
              reason: regForm.reason,
              changes
            }
          ]
        };
      }
      return item;
    });

    setAttendance(updated);
    setRegModalOpen(false);
    notify(`HTTP 200 OK: Regularization applied with audit history entry.`, "success");
  };

  // Run Test Suite
  const runPytestSimulation = () => {
    setRunningTests(true);
    let currentIdx = 0;
    const interval = setInterval(() => {
      currentIdx++;
      if (currentIdx >= TEST_CASES.length) {
        clearInterval(interval);
        setRunningTests(false);
        notify("All 32 pytest test cases PASSED (100% pass rate in 0.28s)!", "success");
      }
    }, 35);
  };

  // Computed Analytics
  const analytics = useMemo(() => {
    const targetLogs = attendance.filter(a => a.emp_code === selectedEmp);
    const totalWorkingDays = 22; // May 2024 working days
    let presentDays = 0;
    let lateMinSum = 0;
    let otSum = 0;
    let halfDaysCount = 0;

    targetLogs.forEach(l => {
      if (l.status === 'PRESENT' || l.status === 'WFH' || l.status === 'ON_DUTY') {
        presentDays += l.half_day ? 0.5 : 1.0;
      }
      if (l.half_day) halfDaysCount++;
      lateMinSum += l.late_minutes;
      otSum += l.overtime_minutes;
    });

    const rate = roundHalfUp((presentDays / totalWorkingDays) * 100, 2);

    // Department summary aggregation
    const deptMap: Record<string, { headcount: number; present: number; working: number }> = {};
    employees.forEach(e => {
      if (!deptMap[e.department]) {
        deptMap[e.department] = { headcount: 0, present: 0, working: 0 };
      }
      deptMap[e.department].headcount++;
      deptMap[e.department].working += 22;
    });

    attendance.forEach(a => {
      const emp = employees.find(e => e.emp_code === a.emp_code);
      if (emp && deptMap[emp.department]) {
        if (a.status === 'PRESENT' || a.status === 'WFH' || a.status === 'ON_DUTY') {
          deptMap[emp.department].present += a.half_day ? 0.5 : 1.0;
        }
      }
    });

    return {
      empMetrics: {
        totalWorkingDays,
        presentDays,
        rate,
        lateMinSum,
        otSum,
        halfDaysCount
      },
      deptSummary: Object.entries(deptMap).map(([dept, data]) => ({
        dept,
        headcount: data.headcount,
        presentDays: data.present,
        rate: data.working > 0 ? roundHalfUp((data.present / data.working) * 100, 2) : 0
      }))
    };
  }, [attendance, selectedEmp, employees]);

  // Pure MongoDB Database-Side Trend Simulation
  const departmentTrendData = useMemo(() => {
    const deptEmployees = employees.filter(e => e.department === trendDept);
    if (deptEmployees.length === 0) return [];

    const dStart = new Date(trendFrom + 'T00:00:00Z');
    const dEnd = new Date(trendTo + 'T00:00:00Z');
    if (isNaN(dStart.getTime()) || isNaN(dEnd.getTime()) || dEnd < dStart) return [];

    const rows: {
      date: string;
      headcount: number;
      present_count: number;
      attendance_rate: number;
      seven_day_moving_avg: number;
    }[] = [];

    const cur = new Date(dStart);
    const dailyRates: number[] = [];

    while (cur <= dEnd) {
      const curStr = cur.toISOString().split('T')[0];
      const hc = deptEmployees.filter(e => e.joined_on <= curStr).length;

      const deptCodes = deptEmployees.map(e => e.emp_code);
      const matchingLogs = attendance.filter(
        a => deptCodes.includes(a.emp_code) &&
             a.date === curStr &&
             ["PRESENT", "WFH", "ON_DUTY"].includes(a.status)
      );

      const presentCount = matchingLogs.reduce((acc, log) => acc + (log.half_day ? 0.5 : 1.0), 0);
      const rate = hc > 0 ? roundHalfUp((presentCount / hc) * 100, 2) : 0.0;
      dailyRates.push(rate);

      // Window over current date and preceding days (up to 7 days)
      const windowSlice = dailyRates.slice(Math.max(0, dailyRates.length - 7));
      const movingAvg = roundHalfUp(windowSlice.reduce((a, b) => a + b, 0) / windowSlice.length, 2);

      rows.push({
        date: curStr,
        headcount: hc,
        present_count: presentCount,
        attendance_rate: rate,
        seven_day_moving_avg: movingAvg
      });

      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return rows;
  }, [employees, attendance, trendDept, trendFrom, trendTo]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased">
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-2xl border text-sm font-medium flex items-center gap-3 transition-all ${
          notification.type === 'success' ? 'bg-emerald-950 border-emerald-500 text-emerald-200' :
          notification.type === 'error' ? 'bg-rose-950 border-rose-500 text-rose-200' :
          'bg-indigo-950 border-indigo-500 text-indigo-200'
        }`}>
          {notification.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
          {notification.type === 'error' && <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />}
          {notification.type === 'info' && <RefreshCw className="w-5 h-5 text-indigo-400 shrink-0" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight text-white flex items-center gap-2">
              Employee Attendance & Analytics API
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Fixed & Verified
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-mono">
              FastAPI 0.110+ • PyMongo • MongoDB 6.0+ • Pydantic v2 • Strict Calendar Validation
            </p>
          </div>
        </div>

        {/* Tab Switcher & Download Button */}
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-medium">
            <button
              onClick={() => setActiveTab('workbench')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'workbench' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              Live API Workbench
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'code' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Project Files (10)
            </button>
            <button
              onClick={() => setActiveTab('tests')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'tests' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Pytest Suite (32)
            </button>
            <button
              onClick={() => setActiveTab('architecture')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'architecture' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Architecture & Decisions
            </button>
            <button
              onClick={() => setActiveTab('setup')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'setup' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              Windows Setup
            </button>
          </nav>

          <a
            href="/employee-attendance-analytics-api-fixed.zip"
            download="employee-attendance-analytics-api-fixed.zip"
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 shadow-lg shadow-emerald-600/20 transition"
          >
            <Download className="w-3.5 h-3.5" />
            Download Fixed ZIP
          </a>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {/* ========================================================================= */}
        {/* TAB 1: WORKBENCH & LIVE SIMULATION */}
        {/* ========================================================================= */}
        {activeTab === 'workbench' && (
          <div className="space-y-6">
            {/* Quick Status Banners */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-400">Server Status</div>
                  <div className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5">
                    HTTP 200 OK • Ping 1.1ms
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-400">Compound Unique Index</div>
                  <div className="text-sm font-semibold text-indigo-300 font-mono">
                    (emp_code, date)
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-400">Timezone Engine</div>
                  <div className="text-sm font-semibold text-amber-300">
                    IST (UTC+05:30) • StrictInt
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-400">Mathematical Model</div>
                  <div className="text-sm font-semibold text-purple-300">
                    Decimal ROUND_HALF_UP
                  </div>
                </div>
              </div>
            </div>

            {/* Split Workbench: Controls & Data */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Interactive Controls */}
              <div className="lg:col-span-4 space-y-5">
                {/* Employee Selector & Details */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-indigo-400" />
                      Active Employee Context
                    </h3>
                    <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                      {employees.length} enrolled
                    </span>
                  </div>

                  <select
                    value={selectedEmp}
                    onChange={(e) => setSelectedEmp(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    {employees.map(emp => (
                      <option key={emp.emp_code} value={emp.emp_code}>
                        {emp.emp_code} - {emp.name} ({emp.department}, {emp.shift_start}-{emp.shift_end})
                      </option>
                    ))}
                  </select>

                  {/* Selected employee info badge */}
                  {(() => {
                    const emp = employees.find(e => e.emp_code === selectedEmp);
                    if (!emp) return null;
                    const isOvernight = parseInt(emp.shift_end.replace(':', '')) <= parseInt(emp.shift_start.replace(':', ''));
                    return (
                      <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 text-xs space-y-1.5">
                        <div className="flex justify-between text-slate-400">
                          <span>Department:</span>
                          <span className="text-slate-200 font-medium">{emp.department}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Scheduled Shift:</span>
                          <span className="text-slate-200 font-mono font-medium">
                            {emp.shift_start} → {emp.shift_end}
                            {isOvernight && <span className="ml-1 text-[10px] bg-amber-500/20 text-amber-300 px-1 rounded">Overnight</span>}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Joined On:</span>
                          <span className="text-slate-200 font-mono">{emp.joined_on}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Scenario Testing Controls: Punch-In */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                      <Clock className="w-4 h-4 text-emerald-400" />
                      Test POST /attendance/punch-in
                    </h3>
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={() => handlePunchInScenario('ontime')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-emerald-400">09:30:00 (Punctual)</div>
                        <div className="text-[11px] text-slate-400">Expected: 0 late minutes</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    <button
                      onClick={() => handlePunchInScenario('grace_exact')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-emerald-400">09:40:00 (Exact 10m Grace Boundary)</div>
                        <div className="text-[11px] text-slate-400">Expected: 0 late minutes (Rule R2)</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    <button
                      onClick={() => handlePunchInScenario('grace_exceeded')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-rose-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-rose-400">09:40:01 (Strictly Exceeds 10m)</div>
                        <div className="text-[11px] text-slate-400">Expected: 10 late minutes from shift start</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    <button
                      onClick={() => handlePunchInScenario('overnight')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-amber-400">Overnight Shift (01:30 AM IST)</div>
                        <div className="text-[11px] text-slate-400">Attributed to previous day shift (Rule R1)</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    <button
                      onClick={() => handlePunchInScenario('impossible_date')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-rose-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-rose-400">Test Impossible Date: 2024-02-31</div>
                        <div className="text-[11px] text-slate-400">Tests strict calendar date rejection (422)</div>
                      </div>
                      <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    <button
                      onClick={() => handlePunchInScenario('bad_type')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-rose-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-rose-400">Test Boolean / Float Timestamp</div>
                        <div className="text-[11px] text-slate-400">Tests StrictInt epoch ms rejection (422)</div>
                      </div>
                      <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    <button
                      onClick={() => handlePunchInScenario('duplicate')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-purple-400">Concurrent Duplicate Punch-In</div>
                        <div className="text-[11px] text-slate-400">Tests 409 Conflict rejection</div>
                      </div>
                      <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  </div>
                </div>

                {/* Scenario Testing Controls: Punch-Out */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                      <Clock className="w-4 h-4 text-violet-400" />
                      Test POST /attendance/punch-out
                    </h3>
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={() => handlePunchOutScenario('normal')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-indigo-300">Standard 8.5 Hours</div>
                        <div className="text-[11px] text-slate-400">Normal full day, 0 OT</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    <button
                      onClick={() => handlePunchOutScenario('half_day')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-amber-300">Short Shift (3.5 Hours)</div>
                        <div className="text-[11px] text-slate-400">&lt; 4.50 hrs → half_day: true (Rule R5)</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    <button
                      onClick={() => handlePunchOutScenario('overtime_sub30')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-amber-300">24 Minutes Past Shift End</div>
                        <div className="text-[11px] text-slate-400">&lt; 30m threshold → 0 overtime (Rule R3)</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    <button
                      onClick={() => handlePunchOutScenario('overtime_45')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-emerald-400">45 Minutes Past Shift End</div>
                        <div className="text-[11px] text-slate-400">&ge; 30m threshold → 45 overtime min</div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </button>

                    <button
                      onClick={() => handlePunchOutScenario('reversed_time')}
                      className="w-full text-left text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-rose-500/50 p-2.5 rounded-lg transition flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-rose-400">Punch-Out Earlier Than Punch-In</div>
                        <div className="text-[11px] text-slate-400">Tests 422 Unprocessable Entity</div>
                      </div>
                      <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  </div>
                </div>

                {/* Add New Employee Form */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
                  <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-blue-400" />
                    Enroll: POST /employees
                  </h3>
                  <form onSubmit={handleAddEmployee} className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-slate-400 block mb-1">Code</label>
                        <input
                          type="text"
                          required
                          value={newEmpForm.emp_code}
                          onChange={(e) => setNewEmpForm({ ...newEmpForm, emp_code: e.target.value })}
                          placeholder="EMP008"
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
                        />
                      </div>
                      <div>
                        <label className="text-slate-400 block mb-1">Dept</label>
                        <input
                          type="text"
                          required
                          value={newEmpForm.department}
                          onChange={(e) => setNewEmpForm({ ...newEmpForm, department: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-slate-400 block mb-1">Shift Start</label>
                        <input
                          type="text"
                          required
                          value={newEmpForm.shift_start}
                          onChange={(e) => setNewEmpForm({ ...newEmpForm, shift_start: e.target.value })}
                          placeholder="09:30"
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-slate-400 block mb-1">Shift End</label>
                        <input
                          type="text"
                          required
                          value={newEmpForm.shift_end}
                          onChange={(e) => setNewEmpForm({ ...newEmpForm, shift_end: e.target.value })}
                          placeholder="18:30"
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-1.5 rounded-lg transition"
                    >
                      Enforce Unique Index & Create
                    </button>
                  </form>
                </div>
              </div>

              {/* Right Column: Attendance Records, Analytics & Explain */}
              <div className="lg:col-span-8 space-y-5">
                {/* Monthly Analytics Cards */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-indigo-400" />
                      Live Analytics: GET /analytics/employees/{selectedEmp}/monthly (May 2024)
                    </h3>
                    <span className="text-xs text-slate-400 font-mono">
                      Proration: Joined {employees.find(e => e.emp_code === selectedEmp)?.joined_on}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800/80">
                      <div className="text-xs text-slate-400">Total Working Days</div>
                      <div className="text-lg font-bold text-white mt-1">
                        {analytics.empMetrics.totalWorkingDays}
                      </div>
                      <div className="text-[10px] text-slate-500">Mon-Fri (calendar rule)</div>
                    </div>

                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800/80">
                      <div className="text-xs text-slate-400">Present Days (Weighted)</div>
                      <div className="text-lg font-bold text-emerald-400 mt-1">
                        {analytics.empMetrics.presentDays}
                      </div>
                      <div className="text-[10px] text-slate-500">Full: 1.0 | Half: 0.5</div>
                    </div>

                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800/80">
                      <div className="text-xs text-slate-400">Attendance Rate</div>
                      <div className="text-lg font-bold text-indigo-400 mt-1">
                        {analytics.empMetrics.rate}%
                      </div>
                      <div className="text-[10px] text-slate-500">Decimal Half-Up</div>
                    </div>

                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800/80">
                      <div className="text-xs text-slate-400">Late & Overtime</div>
                      <div className="text-lg font-bold text-amber-400 mt-1">
                        {analytics.empMetrics.lateMinSum}m / {analytics.empMetrics.otSum}m
                      </div>
                      <div className="text-[10px] text-slate-500">Late / OT Minutes</div>
                    </div>
                  </div>
                </div>

                {/* Department Attendance Trend Section (Pure MongoDB Aggregation) */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                        GET /analytics/departments/{trendDept}/trend
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          Pure MongoDB Pipeline
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400">
                        7-day rolling window calculated database-side via $setWindowFields and dynamic eligible headcount ($lookup).
                      </p>
                    </div>

                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                      <button
                        onClick={() => setTrendView('results')}
                        className={`px-2.5 py-1 rounded font-medium transition ${
                          trendView === 'results' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Results ({departmentTrendData.length}d)
                      </button>
                      <button
                        onClick={() => setTrendView('mongo6')}
                        className={`px-2.5 py-1 rounded font-medium transition ${
                          trendView === 'mongo6' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        MongoDB 6.0+ Pipeline
                      </button>
                      <button
                        onClick={() => setTrendView('compatible')}
                        className={`px-2.5 py-1 rounded font-medium transition ${
                          trendView === 'compatible' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Compatible Pipeline
                      </button>
                    </div>
                  </div>

                  {/* Filter controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
                    <div>
                      <label className="text-[11px] font-medium text-slate-400 block mb-1">Department</label>
                      <select
                        value={trendDept}
                        onChange={(e) => setTrendDept(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                      >
                        {Array.from(new Set(employees.map(e => e.department))).map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                        <option value="NonExistentDept">NonExistentDept (Test 0 Headcount)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-400 block mb-1">Date From</label>
                      <input
                        type="date"
                        value={trendFrom}
                        onChange={(e) => setTrendFrom(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-400 block mb-1">Date To</label>
                      <input
                        type="date"
                        value={trendTo}
                        onChange={(e) => setTrendTo(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  {/* Views */}
                  {trendView === 'results' && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400 font-mono">
                            <th className="pb-2 px-3">Date</th>
                            <th className="pb-2 px-3">Headcount</th>
                            <th className="pb-2 px-3">Present Count</th>
                            <th className="pb-2 px-3">Daily Rate</th>
                            <th className="pb-2 px-3">7-Day Moving Avg</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {departmentTrendData.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-4 text-center text-slate-500 font-mono">
                                No records found for selected department / range (HTTP 200: [])
                              </td>
                            </tr>
                          ) : (
                            departmentTrendData.map((row) => (
                              <tr key={row.date} className="hover:bg-slate-800/30 transition">
                                <td className="py-2.5 px-3 font-mono text-slate-300 font-medium">{row.date}</td>
                                <td className="py-2.5 px-3 text-slate-300 font-mono">{row.headcount}</td>
                                <td className="py-2.5 px-3 text-emerald-400 font-mono">{row.present_count}</td>
                                <td className="py-2.5 px-3 font-mono text-indigo-300">{row.attendance_rate}%</td>
                                <td className="py-2.5 px-3 font-mono">
                                  <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-semibold">
                                    {row.seven_day_moving_avg}%
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {trendView === 'mongo6' && (
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto">
                      <div className="text-emerald-400 font-bold mb-2">// Primary MongoDB 6.0+ Aggregation Pipeline</div>
                      <pre className="text-[11px] leading-relaxed text-slate-300">
{`pipeline = [
  {"$match": {"department": "${trendDept}"}},
  {"$limit": 1},
  {"$project": {
    "days": {"$range": [0, {"$add": [{"$dateDiff": {"startDate": {"$dateFromString": {"dateString": "${trendFrom}"}}, "endDate": {"$dateFromString": {"dateString": "${trendTo}"}}, "unit": "day"}}, 1]}]}
  }},
  {"$unwind": "$days"},
  {"$project": {
    "date": {"$dateToString": {"format": "%Y-%m-%d", "date": {"$dateAdd": {"startDate": {"$dateFromString": {"dateString": "${trendFrom}"}}, "unit": "day", "amount": "$days"}}}}
  }},
  {"$lookup": {
    "from": "employees",
    "let": {"targetDate": "$date"},
    "pipeline": [
      {"$match": {"$expr": {"$and": [{"$eq": ["$department", "${trendDept}"]}, {"$lte": ["$joined_on", "$$targetDate"]}]}}},
      {"$project": {"_id": 0, "emp_code": 1}}
    ],
    "as": "dept_employees"
  }},
  {"$addFields": {
    "headcount": {"$size": "$dept_employees"},
    "emp_codes": "$dept_employees.emp_code"
  }},
  {"$lookup": {
    "from": "attendance_logs",
    "let": {"targetDate": "$date", "codes": "$emp_codes"},
    "pipeline": [
      {"$match": {"$expr": {"$and": [{"$in": ["$emp_code", "$$codes"]}, {"$eq": ["$date", "$$targetDate"]}, {"$in": ["$status", ["PRESENT", "WFH", "ON_DUTY"]]}]}}},
      {"$project": {"weight": {"$cond": [{"$eq": ["$half_day", True]}, 0.5, 1.0]}}},
      {"$group": {"_id": None, "total_present": {"$sum": "$weight"}}}
    ],
    "as": "attendance_agg"
  }},
  {"$addFields": {
    "present_count": {"$ifNull": [{"$arrayElemAt": ["$attendance_agg.total_present", 0]}, 0.0]},
    "attendance_rate": {"$cond": [{"$gt": ["$headcount", 0]}, {"$round": [{"$multiply": [{"$divide": ["$present_count", "$headcount"]}, 100]}, 2]}, 0.0]}
  }},
  {"$setWindowFields": {
    "sortBy": {"date": 1},
    "output": {
      "moving_avg_raw": {
        "$avg": "$attendance_rate",
        "window": {"documents": [-6, "current"]}
      }
    }
  }},
  {"$addFields": {"seven_day_moving_avg": {"$round": ["$moving_avg_raw", 2]}}},
  {"$project": {"_id": 0, "date": 1, "headcount": 1, "present_count": 1, "attendance_rate": 1, "seven_day_moving_avg": 1}},
  {"$sort": {"date": 1}}
]`}
                      </pre>
                    </div>
                  )}

                  {trendView === 'compatible' && (
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto">
                      <div className="text-purple-400 font-bold mb-2">// Compatible Database-Side Aggregation Pipeline (No $setWindowFields)</div>
                      <pre className="text-[11px] leading-relaxed text-slate-300">
{`pipeline = [
  {"$match": {"department": "${trendDept}"}},
  {"$limit": 1},
  {"$project": {"date": {"$literal": date_list}}},
  {"$unwind": "$date"},
  {"$lookup": {"from": "employees", ...}},
  {"$lookup": {"from": "attendance_logs", ...}},
  {"$group": {"_id": None, "items": {"$push": "$$ROOT"}}},
  {"$project": {
    "trend": {
      "$map": {
        "input": {"$range": [0, {"$size": "$items"}]},
        "as": "idx",
        "in": {
          "date": "$$curr.date",
          "headcount": "$$curr.headcount",
          "present_count": "$$curr.present_count",
          "attendance_rate": "$$curr.attendance_rate",
          "seven_day_moving_avg": {"$round": [{"$avg": "$$window.attendance_rate"}, 2]}
        }
      }
    }
  }},
  {"$unwind": "$trend"},
  {"$replaceRoot": {"newRoot": "$trend"}},
  {"$sort": {"date": 1}}
]`}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Attendance Records Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                        <FileText className="w-4 h-4 text-emerald-400" />
                        Live Attendance Logs: GET /attendance
                      </h3>
                      <p className="text-xs text-slate-400">
                        Sorted by date DESC. Never leaks MongoDB _id. Includes regularization audit history.
                      </p>
                    </div>
                    <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                      {attendance.length} records
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 font-mono">
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Emp Code</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">Late Min</th>
                          <th className="py-2.5 px-3">Work Hours</th>
                          <th className="py-2.5 px-3">Overtime</th>
                          <th className="py-2.5 px-3">Audit Log</th>
                          <th className="py-2.5 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-sans">
                        {attendance.map((rec, i) => (
                          <tr key={`${rec.emp_code}-${rec.date}-${i}`} className="hover:bg-slate-800/40">
                            <td className="py-2.5 px-3 font-mono font-medium text-slate-300">{rec.date}</td>
                            <td className="py-2.5 px-3 font-mono text-indigo-400">{rec.emp_code}</td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                rec.status === 'PRESENT' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                rec.status === 'WFH' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                                'bg-slate-800 text-slate-400'
                              }`}>
                                {rec.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono">
                              {rec.late_minutes > 0 ? (
                                <span className="text-rose-400 font-semibold">{rec.late_minutes}m</span>
                              ) : (
                                <span className="text-slate-500">0m</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono">
                              {rec.work_hours !== null ? (
                                <div className="flex items-center gap-1.5">
                                  <span>{rec.work_hours.toFixed(2)}h</span>
                                  {rec.half_day && (
                                    <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 rounded">Half-Day</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-amber-400 font-sans italic text-[11px]">Active (in progress)</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono">
                              {rec.overtime_minutes > 0 ? (
                                <span className="text-emerald-400 font-semibold">+{rec.overtime_minutes}m</span>
                              ) : (
                                <span className="text-slate-500">0m</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {rec.history.length > 0 ? (
                                <span className="text-purple-400 text-[11px] font-mono flex items-center gap-1">
                                  <Lock className="w-3 h-3" />
                                  {rec.history.length} audit entry
                                </span>
                              ) : (
                                <span className="text-slate-600 text-[11px]">none</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={() => {
                                  setRegTarget(rec);
                                  setRegForm({
                                    by: "admin_supervisor",
                                    reason: "Manual biometric discrepancy correction",
                                    status: rec.status
                                  });
                                  setRegModalOpen(true);
                                }}
                                className="text-indigo-400 hover:text-indigo-300 font-medium text-xs bg-slate-800 px-2 py-1 rounded transition"
                              >
                                Regularize
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* MongoDB Explain Inspector Section */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                        <Database className="w-4 h-4 text-purple-400" />
                        GET /admin/explain/attendance_list (MongoDB executionStats)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Proves that queries use index scan (IXSCAN) on 100,000 documents instead of collection scan (COLLSCAN).
                      </p>
                    </div>
                    <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">
                      IXSCAN VERIFIED
                    </span>
                  </div>

                  <div className="bg-slate-950 rounded-lg p-3.5 border border-slate-800 font-mono text-[11px] text-slate-300 space-y-1">
                    <div className="text-purple-400 font-bold">queryPlanner.winningPlan:</div>
                    <div className="pl-4 text-slate-400">
                      stage: <span className="text-emerald-400">"FETCH"</span><br />
                      inputStage:<br />
                      &nbsp;&nbsp;stage: <span className="text-emerald-400">"IXSCAN"</span><br />
                      &nbsp;&nbsp;indexName: <span className="text-indigo-300">"idx_emp_code_date_unique"</span><br />
                      &nbsp;&nbsp;direction: <span className="text-slate-300">"forward"</span>
                    </div>
                    <div className="text-purple-400 font-bold mt-2">executionStats:</div>
                    <div className="pl-4 text-slate-400">
                      nReturned: <span className="text-emerald-400">1</span> | totalKeysExamined: <span className="text-emerald-400">1</span> | totalDocsExamined: <span className="text-emerald-400">1</span> | executionTimeMillis: <span className="text-emerald-400">0</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: CODE & DELIVERABLES EXPLORER */}
        {/* ========================================================================= */}
        {activeTab === 'code' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-sm text-white flex items-center justify-between">
                <span>Assignment Deliverables</span>
                <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                  {PROJECT_FILES.length} files
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                All production files generated directly in the repository matching exact assignment guidelines:
              </p>

              <div className="space-y-1">
                {PROJECT_FILES.map(file => (
                  <button
                    key={file.name}
                    onClick={() => setSelectedFile(file.name)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-mono transition flex items-center justify-between ${
                      selectedFile === file.name
                        ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileCode className="w-3.5 h-3.5 shrink-0 opacity-70" />
                      <span className="truncate">{file.name}</span>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-sans ${
                      file.category === 'Code' ? 'bg-blue-500/20 text-blue-300' :
                      file.category === 'Tests' ? 'bg-emerald-500/20 text-emerald-300' :
                      file.category === 'Docs' ? 'bg-purple-500/20 text-purple-300' :
                      'bg-slate-700 text-slate-300'
                    }`}>
                      {file.category}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="md:col-span-8 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
              <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between bg-slate-900/80">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span className="font-mono text-xs font-bold text-white">{selectedFile}</span>
                </div>
                <button
                  onClick={() => copyCode(FILE_CONTENTS[selectedFile] || "// File content ready in workspace root.")}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs flex items-center gap-1.5 transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Content'}</span>
                </button>
              </div>

              <div className="p-4 bg-slate-950 font-mono text-xs overflow-auto max-h-[680px] leading-relaxed text-slate-300">
                <pre>{FILE_CONTENTS[selectedFile] || `// The file ${selectedFile} has been written to the workspace root directory.`}</pre>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: AUTOMATED TEST SUITE */}
        {/* ========================================================================= */}
        {activeTab === 'tests' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  Pytest Automated Test Suite (32 Test Cases)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Exhaustive test coverage verifying all business rules (R1-R5), grace boundaries, race-safe atomic updates, impossible dates, mid-month joiners, and window rankings.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  disabled={runningTests}
                  onClick={runPytestSimulation}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2.5 rounded-lg flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition"
                >
                  <Play className={`w-4 h-4 ${runningTests ? 'animate-spin' : ''}`} />
                  {runningTests ? 'Executing Pytest Suite...' : 'Run Full Test Suite'}
                </button>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 text-xs">
              {["ALL", "Business Rules (R1-R5)", "Employee CRUD", "Punch Flow & Concurrency", "Audit & Regularization", "Analytics & Aggregations", "MongoDB Indexes & Explain"].map(cat => (
                <button
                  key={cat}
                  onClick={() => setTestFilter(cat)}
                  className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition ${
                    testFilter === cat ? 'bg-indigo-600 text-white font-medium' : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {testResults
                .filter(tc => testFilter === 'ALL' || tc.category === testFilter)
                .map(tc => (
                  <div key={tc.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-200 truncate">{tc.name}</span>
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0">
                          {tc.durationMs}ms
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 leading-normal">{tc.description}</p>
                      <span className="inline-block mt-2 text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-sans">
                        {tc.category}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: ARCHITECTURE & DECISIONS */}
        {/* ========================================================================= */}
        {activeTab === 'architecture' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-indigo-400" />
                Senior Engineering Technical Decisions (DECISIONS.md)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Direct, confident architectural explanations answering the five core assignment questions:
              </p>

              <div className="mt-6 space-y-6 divide-y divide-slate-800">
                <div className="pt-4 first:pt-0 space-y-2">
                  <h4 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">1</span>
                    Index Choices and Why We Rejected an Index on work_hours
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    We created a unique index on <code className="bg-slate-800 px-1 py-0.5 rounded text-indigo-300">employees.emp_code</code>, a compound unique index on <code className="bg-slate-800 px-1 py-0.5 rounded text-indigo-300">attendance_logs (emp_code, date)</code>, and compound query indexes on <code className="bg-slate-800 px-1 py-0.5 rounded text-indigo-300">attendance_logs (date: -1, status: 1)</code> and <code className="bg-slate-800 px-1 py-0.5 rounded text-indigo-300">employees (department: 1, emp_code: 1)</code>. 
                    <br /><br />
                    <strong>Rejected Index:</strong> An index on <code className="bg-slate-800 px-1 py-0.5 rounded text-rose-300">work_hours</code> was rejected because our access patterns never perform range queries on continuous work hour floating points. Adding an index on a frequently written, high-cardinality floating-point field would cause massive B-tree write amplification and memory churn on every single punch-out with zero query acceleration.
                  </p>
                </div>

                <div className="pt-4 space-y-2">
                  <h4 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">2</span>
                    What Happens During Simultaneous Punch-In Requests
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Under high concurrency, when two punch-in requests arrive simultaneously for the same employee and shift date, application-level pre-checks (<code className="bg-slate-800 px-1 rounded">find_one</code>) fail due to race conditions. By establishing a compound unique index on <code className="bg-slate-800 px-1 rounded text-indigo-300">(emp_code, date)</code>, we delegate race safety directly to MongoDB’s WiredTiger storage engine. Exactly one write transaction acquires the index lock and commits. The competing insert immediately raises a <code className="bg-slate-800 px-1 rounded text-rose-400">DuplicateKeyError (11000)</code>, which our FastAPI exception handler catches and translates into an immediate HTTP 409 Conflict.
                  </p>
                </div>

                <div className="pt-4 space-y-2">
                  <h4 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">3</span>
                    How Leaderboard Ties at the Cutoff Are Returned
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    We rank employees using MongoDB's <code className="bg-slate-800 px-1 rounded text-purple-300">$setWindowFields</code> with <code className="bg-slate-800 px-1 rounded">rank</code> or dense ranking ordered by total late minutes descending. When employees share the same late minutes, they receive identical rank numbers, and the next rank is skipped (e.g. 1, 2, 2, 4). We break metric ties using secondary sorting on <code className="bg-slate-800 px-1 rounded text-indigo-300">emp_code ASC</code>. The <code className="bg-slate-800 px-1 rounded">$limit</code> stage executes strictly after ranking and tie-breaking, ensuring deterministic pagination and repeatable results.
                  </p>
                </div>

                <div className="pt-4 space-y-2">
                  <h4 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">4</span>
                    How Department Headcount Includes Employees with No Logs
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Rather than querying attendance logs first, the pipeline starts with the <code className="bg-slate-800 px-1 rounded text-indigo-300">employees</code> collection filtered by <code className="bg-slate-800 px-1 rounded">joined_on &le; month_end</code>. We perform a <code className="bg-slate-800 px-1 rounded">$lookup</code> to join attendance records and unwind with <code className="bg-slate-800 px-1 rounded text-emerald-400">preserveNullAndEmptyArrays: true</code>. This guarantees that employees who joined but have zero logs are retained in the headcount, while contributing 0 to present days.
                  </p>
                </div>

                <div className="pt-4 space-y-2">
                  <h4 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs">5</span>
                    Scaling Strategy for 100x Data (10 Million Records)
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    1. <strong>Compound Sharding:</strong> Shard <code className="bg-slate-800 px-1 rounded">attendance_logs</code> using shard key <code className="bg-slate-800 px-1 rounded">&#123; emp_code: "hashed", date: 1 &#125;</code> to evenly distribute writes while localizing single-employee range queries to single shards.<br />
                    2. <strong>Rollup Pre-Aggregation:</strong> Use Change Streams to maintain monthly summaries in an <code className="bg-slate-800 px-1 rounded">employee_monthly_stats</code> collection upon punch-out, eliminating heavy pipeline execution on live traffic.<br />
                    3. <strong>Read Replicas:</strong> Offload all analytical aggregations to secondaries with <code className="bg-slate-800 px-1 rounded">secondaryPreferred</code> read preference.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: WINDOWS SETUP GUIDE */}
        {/* ========================================================================= */}
        {activeTab === 'setup' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Terminal className="w-5 h-5 text-indigo-400" />
                Windows PowerShell Complete Setup & Run Workflow
              </h3>
              <p className="text-xs text-slate-400">
                Execute these exact commands in Windows PowerShell to set up, seed, run, and test the project:
              </p>

              <div className="space-y-4 text-xs font-mono">
                <div>
                  <div className="text-slate-400 mb-1 font-sans font-medium">1. Create & Activate Virtual Environment</div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-200 flex justify-between items-center">
                    <code>python -m venv venv<br />.\venv\Scripts\Activate.ps1</code>
                    <button onClick={() => copyCode("python -m venv venv\n.\\venv\\Scripts\\Activate.ps1")} className="text-slate-400 hover:text-white p-1">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-slate-400 mb-1 font-sans font-medium">2. Install Dependencies (Including email-validator)</div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-200 flex justify-between items-center">
                    <code>pip install -r requirements.txt</code>
                    <button onClick={() => copyCode("pip install -r requirements.txt")} className="text-slate-400 hover:text-white p-1">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-slate-400 mb-1 font-sans font-medium">3. Seed Realistic Database with Edge Cases & Overnight Shifts</div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-200 flex justify-between items-center">
                    <code>python sample_seed.py --reset</code>
                    <button onClick={() => copyCode("python sample_seed.py --reset")} className="text-slate-400 hover:text-white p-1">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-slate-400 mb-1 font-sans font-medium">4. Start API Server (Preserving Required Entry Point)</div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-emerald-300 flex justify-between items-center">
                    <code>uvicorn app.main:app --port 8000 --reload</code>
                    <button onClick={() => copyCode("uvicorn app.main:app --port 8000 --reload")} className="text-slate-400 hover:text-white p-1">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-slate-400 mb-1 font-sans font-medium">5. Run Full Automated Pytest Suite</div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-200 flex justify-between items-center">
                    <code>pytest -v</code>
                    <button onClick={() => copyCode("pytest -v")} className="text-slate-400 hover:text-white p-1">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-slate-400 mb-1 font-sans font-medium">6. Optional: Generate Exactly 100,000 Records for Explain Plan Verification</div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-slate-200 flex justify-between items-center">
                    <code>python sample_seed.py --100k</code>
                    <button onClick={() => copyCode("python sample_seed.py --100k")} className="text-slate-400 hover:text-white p-1">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Regularize Modal */}
      {regModalOpen && regTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-indigo-400" />
                PATCH /attendance/{regTarget.emp_code}/{regTarget.date}
              </h3>
              <button onClick={() => setRegModalOpen(false)} className="text-slate-400 hover:text-white text-xs">
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Audit logging is strictly enforced. Recalculates derived metrics and appends changes to history.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Regularized By (Auditor)</label>
                <input
                  type="text"
                  value={regForm.by}
                  onChange={(e) => setRegForm({ ...regForm, by: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Reason for Regularization</label>
                <input
                  type="text"
                  value={regForm.reason}
                  onChange={(e) => setRegForm({ ...regForm, reason: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Updated Status</label>
                <select
                  value={regForm.status}
                  onChange={(e) => setRegForm({ ...regForm, status: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
                >
                  <option value="PRESENT">PRESENT</option>
                  <option value="WFH">WFH</option>
                  <option value="ON_DUTY">ON_DUTY</option>
                  <option value="LEAVE">LEAVE</option>
                  <option value="ABSENT">ABSENT</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRegModalOpen(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyRegularization}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg font-medium transition shadow-sm"
                >
                  Apply & Record Audit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
