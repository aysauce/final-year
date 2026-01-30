// Auth guard
const token = localStorage.getItem('token');
const role = localStorage.getItem('role');
if (!token || role !== 'teacher') { window.location.href = '/'; }

async function loadTeacherGreeting() {
  const greet = document.getElementById('teacherGreeting');
  if (!greet) return;
  try {
    const me = await get(`${window.API_BASE}/teacher/me`);
    const title = String(me.title || '').toLowerCase();
    const sex = String(me.sex || '').toLowerCase();
    const lastName = me.surname || '';
    let prefix = '';
    if (sex === 'female') {
      if (title === 'mrs' || title === 'miss') {
        prefix = title;
      } else if (title === 'dr' || title === 'prof') {
        prefix = title;
      } else {
        prefix = 'mrs';
      }
    } else {
      if (title === 'dr' || title === 'prof') {
        prefix = title;
      } else {
        prefix = 'mr';
      }
    }
    const nicePrefix = prefix ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : '';
    greet.textContent = lastName ? `Hello, ${nicePrefix} ${lastName}` : 'Hello';
  } catch (e) {
    greet.textContent = 'Hello';
  }
}

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
let lastCompletedSessionId = null;
let lastCompletedCourseId = null;
let courseReportData = null;

function renderAttendance(rows) {
  const tbody = document.querySelector('#attendanceTable tbody');
  tbody.innerHTML = '';
  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    const nameParts = [r.surname, r.first_name, r.middle_name].filter(Boolean);
    const fullName = nameParts.join(' ');
    tr.innerHTML = `<td>${idx + 1}</td><td>${new Date(r.timestamp).toLocaleString()}</td><td>${fullName}</td><td>${r.matric_number || ''}</td>`;
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
    if (t) t.innerHTML = `<strong>${m}m ${s}s</strong>`;
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
    lastCompletedSessionId = currentSessionId;
    lastCompletedCourseId = selectedCourseId;
    const downloadBtn = document.getElementById('downloadCsv');
    if (downloadBtn) downloadBtn.disabled = false;
    currentSessionId = null;
    document.getElementById('sessionInfo').textContent = 'No active session';
    document.getElementById('togglePauseBtn').disabled = true;
    document.getElementById('togglePauseBtn').textContent = 'Pause';
    document.getElementById('endSessionBtn').disabled = true;
  } catch (e) { alert(e.message); }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
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
  const manageSel = document.getElementById('manageCourseSelect');
  if (manageSel) manageSel.value = String(id);
  const found = courses.find(c => Number(c.id) === Number(id));
  if (found) {
    const nameInput = document.getElementById('courseName');
    const codeInput = document.getElementById('courseCode');
    const passInput = document.getElementById('coursePassMark');
    if (nameInput) nameInput.value = found.name || '';
    if (codeInput) codeInput.value = found.code || '';
    if (passInput) passInput.value = Number.isFinite(found.pass_mark) ? found.pass_mark : 75;
  }
  highlightCourseRows();
  syncCourseControls();
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
  const reportSel = document.getElementById('courseReportSelect');
  if (reportSel) {
    reportSel.innerHTML = '<option value="">Select a course</option>';
    courses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = `${c.code} - ${c.name}`;
      reportSel.appendChild(opt);
    });
  }
  const manageSel = document.getElementById('manageCourseSelect');
  if (manageSel) {
    manageSel.innerHTML = '<option value="">New course</option>';
    courses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = `${c.code} - ${c.name}`;
      manageSel.appendChild(opt);
    });
    if (selectedCourseId) manageSel.value = String(selectedCourseId);
  }
  highlightCourseRows();
}

document.getElementById('courseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('courseName').value.trim();
  const code = document.getElementById('courseCode').value.trim();
  const passMark = Number(document.getElementById('coursePassMark').value);
  try {
    if (selectedCourseId) {
      await post(`${window.API_BASE}/teacher/courses/${selectedCourseId}`, { name, code, passMark });
    } else {
      await post(`${window.API_BASE}/teacher/courses`, { name, code, passMark });
    }
    document.getElementById('courseName').value = '';
    document.getElementById('courseCode').value = '';
    document.getElementById('coursePassMark').value = '75';
    selectedCourseId = null;
    await loadCourses();
    syncCourseControls();
  } catch (e) { alert(e.message); }
});

document.getElementById('courseSelect').addEventListener('change', (e) => {
  const val = Number(e.target.value);
  if (Number.isFinite(val)) {
    setCourseSelection(val);
  }
});

const manageSelect = document.getElementById('manageCourseSelect');
if (manageSelect) {
  manageSelect.addEventListener('change', (e) => {
    const val = Number(e.target.value);
    if (!val) {
      selectedCourseId = null;
      document.getElementById('courseName').value = '';
      document.getElementById('courseCode').value = '';
      document.getElementById('coursePassMark').value = '75';
      highlightCourseRows();
      syncCourseControls();
      return;
    }
    setCourseSelection(val);
    syncCourseControls();
  });
}

function syncCourseControls() {
  const saveBtn = document.getElementById('saveCourseBtn');
  const deleteBtn = document.getElementById('deleteCourseBtn');
  if (saveBtn) saveBtn.textContent = selectedCourseId ? 'Update Course' : 'Add Course';
  if (deleteBtn) deleteBtn.disabled = !selectedCourseId;
}

const deleteCourseBtn = document.getElementById('deleteCourseBtn');
if (deleteCourseBtn) {
  deleteCourseBtn.addEventListener('click', async () => {
    if (!selectedCourseId) return;
    if (!confirm('Drop this course?')) return;
    try {
      await post(`${window.API_BASE}/teacher/courses/${selectedCourseId}/delete`, {});
      selectedCourseId = null;
      document.getElementById('courseName').value = '';
      document.getElementById('courseCode').value = '';
      document.getElementById('coursePassMark').value = '75';
      await loadCourses();
      syncCourseControls();
    } catch (e) {
      alert(e.message);
    }
  });
}

document.getElementById('startForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const courseId = Number(document.getElementById('courseSelect').value);
  const duration = Number(document.getElementById('duration').value);
  setCourseSelection(courseId);
  const info = document.getElementById('sessionInfo');
  try {
    const data = await post(`${window.API_BASE}/teacher/create-session`, { courseId, duration });
    currentSessionId = data.id;
    lastCompletedSessionId = null;
    lastCompletedCourseId = null;
    const downloadBtn = document.getElementById('downloadCsv');
    if (downloadBtn) downloadBtn.disabled = true;
    info.innerHTML = `<strong>${new Date(data.end_time).toLocaleTimeString()}</strong>`;
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

loadTeacherGreeting();
loadCourses().then(syncCourseControls);

// Auth downloads
document.getElementById('downloadCsv').addEventListener('click', async () => {
  if (!lastCompletedSessionId) return alert('No completed session to export.');
  try {
    const res = await fetch(`${window.API_BASE}/teacher/get-attendance/${lastCompletedSessionId}?format=csv`, { headers: authHeaders() });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const course = courses.find((c) => Number(c.id) === Number(lastCompletedCourseId));
    const courseSlug = course ? `${course.code}-${course.name}`.replace(/\s+/g, '-').toLowerCase() : `session-${lastCompletedSessionId}`;
    const dateSlug = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `${courseSlug}-${dateSlug}.csv`; a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('Download failed'); }
});

document.getElementById('downloadCourseCsv').addEventListener('click', async () => {
  const sel = document.getElementById('courseReportSelect');
  const courseId = Number(sel && sel.value);
  if (!courseId) return alert('Select a course first');
  try {
    const scale = Number(document.getElementById('courseReportScale')?.value);
    const scaleParam = Number.isFinite(scale) && scale > 0 ? `&scale=${scale}` : '';
    const res = await fetch(`${window.API_BASE}/teacher/course-attendance/${courseId}?format=xlsx${scaleParam}`, { headers: authHeaders() });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const course = courses.find((c) => Number(c.id) === Number(courseId));
    const courseSlug = course ? `${course.code}-${course.name}`.replace(/\s+/g, '-').toLowerCase() : `course-${courseId}`;
    a.href = url; a.download = `${courseSlug}-attendance.xlsx`; a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('Download failed'); }
});

async function loadCourseReport(courseId) {
  if (!courseId) return;
  try {
    const data = await get(`${window.API_BASE}/teacher/course-attendance/${courseId}`);
    courseReportData = data;
    renderCourseReport();
  } catch (e) {
    courseReportData = null;
    renderCourseReport();
  }
}

function renderCourseReport() {
  const tbody = document.querySelector('#courseReportTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!courseReportData) return;
  const scale = Number(document.getElementById('courseReportScale')?.value) || 10;
  const search = (document.getElementById('courseReportSearch')?.value || '').toLowerCase();
  let filtered = courseReportData.students.filter((s) => {
      const name = [s.surname, s.first_name, s.middle_name].filter(Boolean).join(' ').toLowerCase();
      const matric = String(s.matric_number || '').toLowerCase();
      return !search || name.includes(search) || matric.includes(search);
    });
  if (!search) filtered = filtered.slice(0, 5);
  filtered.forEach((s) => {
      const tr = document.createElement('tr');
      tr.className = s.status === 'passed' ? 'pass-row' : 'fail-row';
      const name = [s.surname, s.first_name, s.middle_name].filter(Boolean).join(' ');
      const total = s.total || 0;
      const score = total ? Math.round((s.attended / total) * scale) : 0;
      tr.innerHTML = `<td>${name}</td><td>${s.matric_number || ''}</td><td>${s.attended}/${total}</td><td>${score}/${scale}</td><td>${s.status}</td>`;
      tbody.appendChild(tr);
    });
}

const reportSelect = document.getElementById('courseReportSelect');
if (reportSelect) {
  reportSelect.addEventListener('change', (e) => {
    const courseId = Number(e.target.value);
    loadCourseReport(courseId);
  });
}
const reportSearch = document.getElementById('courseReportSearch');
if (reportSearch) {
  reportSearch.addEventListener('input', renderCourseReport);
}
const reportScale = document.getElementById('courseReportScale');
if (reportScale) {
  reportScale.addEventListener('input', renderCourseReport);
}
const reportRefresh = document.getElementById('courseReportRefresh');
if (reportRefresh) {
  reportRefresh.addEventListener('click', () => {
    const courseId = Number(document.getElementById('courseReportSelect')?.value);
    if (courseId) loadCourseReport(courseId);
  });
}
