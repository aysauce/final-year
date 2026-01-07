// Auth guard
const token = localStorage.getItem('token');
const role = localStorage.getItem('role');
if (!token || role !== 'teacher') { window.location.href = '/'; }

function authHeaders() {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

async function get(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

let currentSessionId = null;
let pollTimer = null;
let courses = [];
let timerInterval = null;
let sessionEndMs = null;
let selectedCourseId = null;

function renderAttendance(rows) {
  const tbody = document.querySelector('#attendanceTable tbody');
  tbody.innerHTML = '';
  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    const cred = (r.credential_id || '').slice(0, 8);
    tr.innerHTML = `<td>${idx + 1}</td><td>${new Date(r.timestamp).toLocaleString()}</td><td>${r.email || ''}</td><td>${r.matric_number || ''}</td><td>${r.course_code || ''}</td><td>${cred}</td>`;
    tbody.appendChild(tr);
  });
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  const t = document.getElementById('timerText');
  if (t) t.textContent = '';
}

function startTimer(endTime) {
  sessionEndMs = new Date(endTime).getTime();
  stopTimer();
  timerInterval = setInterval(() => {
    const remain = Math.max(0, sessionEndMs - Date.now());
    const m = Math.floor(remain / 60000);
    const s = Math.floor((remain % 60000) / 1000);
    const t = document.getElementById('timerText');
    if (t) t.textContent = `Time left: ${m}m ${s}s`;
    if (remain <= 0) stopTimer();
  }, 1000);
}

async function pollAttendance() {
  if (!currentSessionId) return;
  try {
    const rows = await get(`${window.API_BASE}/teacher/get-attendance/${currentSessionId}`);
    renderAttendance(rows);
  } catch (e) {
    console.warn('poll failed', e);
  }
}

document.getElementById('togglePauseBtn').addEventListener('click', async () => {
  if (!currentSessionId) return;
  try {
    const res = await post(`${window.API_BASE}/teacher/pause-session`, { sessionId: currentSessionId });
    pollAttendance();
    const btn = document.getElementById('togglePauseBtn');
    if (res.status === 'paused') {
      btn.textContent = 'Resume';
      stopTimer();
    } else {
      btn.textContent = 'Pause';
      if (sessionEndMs) startTimer(sessionEndMs);
    }
  } catch (e) { alert(e.message); }
});

document.getElementById('endSessionBtn').addEventListener('click', async () => {
  if (!currentSessionId) return;
  try {
    await post(`${window.API_BASE}/teacher/end-session`, { sessionId: currentSessionId });
    clearInterval(pollTimer);
    pollTimer = null;
    stopTimer();
    currentSessionId = null;
    document.getElementById('sessionInfo').textContent = 'No active session';
    document.getElementById('togglePauseBtn').disabled = true;
    document.getElementById('togglePauseBtn').textContent = 'Pause';
    document.getElementById('endSessionBtn').disabled = true;
  } catch (e) { alert(e.message); }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.clear();
  location.href = '/';
});

function highlightCourseRows() {
  const rows = document.querySelectorAll('#coursesTable tbody tr');
  rows.forEach(tr => tr.classList.toggle('selected', Number(tr.dataset.id) === selectedCourseId));
}

function setCourseSelection(id) {
  if (!Number.isFinite(id)) return;
  selectedCourseId = id;
  const sel = document.getElementById('courseSelect');
  if (sel) sel.value = String(id);
  highlightCourseRows();
}

async function loadCourses() {
  try { courses = await get(`${window.API_BASE}/teacher/courses`); } catch { courses = []; }
  const tbody = document.querySelector('#coursesTable tbody');
  tbody.innerHTML = '';
  courses.forEach(c => {
    const tr = document.createElement('tr');
    tr.dataset.id = c.id;
    tr.innerHTML = `<td>${c.code}</td><td>${c.name}</td>`;
    tr.addEventListener('click', () => setCourseSelection(Number(c.id)));
    tbody.appendChild(tr);
  });
  // Populate dropdown
  const sel = document.getElementById('courseSelect');
  if (sel) {
    sel.innerHTML = '<option value="">Select a course</option>';
    courses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = `${c.code} - ${c.name}`;
      sel.appendChild(opt);
    });
    if (selectedCourseId) sel.value = String(selectedCourseId);
  }
  highlightCourseRows();
}

document.getElementById('courseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('courseName').value.trim();
  const code = document.getElementById('courseCode').value.trim();
  try {
    await post(`${window.API_BASE}/teacher/courses`, { name, code });
    document.getElementById('courseName').value = '';
    document.getElementById('courseCode').value = '';
    await loadCourses();
  } catch (e) { alert(e.message); }
});

document.getElementById('courseSelect').addEventListener('change', (e) => {
  const val = Number(e.target.value);
  if (Number.isFinite(val)) {
    selectedCourseId = val;
    highlightCourseRows();
  }
});

document.getElementById('startForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const courseId = Number(document.getElementById('courseSelect').value);
  const duration = Number(document.getElementById('duration').value);
  setCourseSelection(courseId);
  const info = document.getElementById('sessionInfo');
  try {
    const data = await post(`${window.API_BASE}/teacher/create-session`, { courseId, duration });
    currentSessionId = data.id;
    info.textContent = `Session ${data.id} active until ${new Date(data.end_time).toLocaleTimeString()}`;
    document.getElementById('togglePauseBtn').disabled = false;
    document.getElementById('endSessionBtn').disabled = false;
    document.getElementById('togglePauseBtn').textContent = 'Pause';
    startTimer(data.end_time);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollAttendance, 5000);
    pollAttendance();
  } catch (e) {
    info.textContent = e.message;
  }
});

loadCourses();

// Auth downloads
document.getElementById('downloadCsv').addEventListener('click', async () => {
  if (!currentSessionId) return alert('No active session to export.');
  try {
    const res = await fetch(`${window.API_BASE}/teacher/get-attendance/${currentSessionId}?format=csv`, { headers: authHeaders() });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `attendance-${currentSessionId}.csv`; a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('Download failed'); }
});

document.getElementById('downloadCourseCsv').addEventListener('click', async () => {
  const sel = document.getElementById('courseSelect');
  const courseId = Number(sel && sel.value);
  if (!courseId) return alert('Select a course first');
  try {
    const res = await fetch(`${window.API_BASE}/teacher/course-report/${courseId}?format=csv`, { headers: authHeaders() });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `course-${courseId}-report.csv`; a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('Download failed'); }
});
