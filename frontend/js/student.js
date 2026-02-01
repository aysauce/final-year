function authHeaders() {
  const t = localStorage.getItem('token');
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
}

async function post(url, body = {}) {
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function get(url) {
  const res = await fetch(url, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const WebAuthn = window.WebAuthnHelpers || {};
const { preformatCreateOptions, bufferEncode } = WebAuthn;

async function loadProfile() {
  const greet = document.getElementById('studentGreeting');
  if (!greet) return;
  try {
    const me = await get(`${window.API_BASE}/student/me`);
    const firstName = me.first_name || '';
    greet.textContent = firstName ? `Hello, ${firstName}` : 'Hello';
  } catch (e) {
    greet.textContent = 'Hello';
  }
}

// OTP + attendance -----------------------------------------------------------
document.getElementById('otpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sessionId = Number(document.getElementById('sessionId').value);
  const msg = document.getElementById('otpMsg');
  if (!sessionId) {
    msg.textContent = 'Select a course from the list first.';
    return;
  }
  msg.textContent = 'Requesting OTP...';
  try {
    await post(`${window.API_BASE}/student/generate-otp`, { sessionId });
    msg.textContent = 'OTP was sent to your email';
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById('submitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sessionId = Number(document.getElementById('submitSessionId').value);
  const otp = document.getElementById('otp').value.trim();
  const msg = document.getElementById('submitMsg');
  if (!sessionId) {
    msg.textContent = 'Select a course from the list first.';
    return;
  }
  msg.textContent = 'Submitting...';
  try {
    const res = await post(`${window.API_BASE}/student/submit-attendance`, { sessionId, otp });
    msg.textContent = res.alreadyRecorded ? 'Attendance already recorded recently.' : 'Attendance recorded!';
    loadHistory();
  } catch (err) {
    msg.textContent = err.message;
  }
});

let historyRows = [];

function formatWATDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function formatWATTime(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function normalizeCourseKey(row) {
  return (row.course_code || row.course_name || '').trim();
}

function updateCourseOptions() {
  const select = document.getElementById('historyCourse');
  if (!select) return;
  const existing = new Set();
  const options = [];
  historyRows.forEach((r) => {
    const key = normalizeCourseKey(r);
    if (!key || existing.has(key)) return;
    existing.add(key);
    const label = r.course_code && r.course_name ? `${r.course_code} - ${r.course_name}` : key;
    options.push({ value: key, label });
  });
  select.innerHTML = '<option value="">All courses (last 7 only)</option>';
  options.forEach((opt) => {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    select.appendChild(el);
  });
}

function getRangeFilter() {
  const range = document.getElementById('historyRange')?.value || 'last7';
  const now = new Date();
  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const end = start + 24 * 60 * 60 * 1000 - 1;
    return (row) => {
      const t = new Date(row.timestamp).getTime();
      return t >= start && t <= end;
    };
  }
  if (range === 'yesterday') {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 1;
    const start = end - 24 * 60 * 60 * 1000 + 1;
    return (row) => {
      const t = new Date(row.timestamp).getTime();
      return t >= start && t <= end;
    };
  }
  if (range === 'week') {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return (row) => new Date(row.timestamp).getTime() >= cutoff;
  }
  if (range === 'month') {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).getTime();
    return (row) => new Date(row.timestamp).getTime() >= cutoff;
  }
  if (range === 'custom') {
    const fromVal = document.getElementById('historyFrom')?.value;
    const toVal = document.getElementById('historyTo')?.value;
    const from = fromVal ? new Date(`${fromVal}T00:00:00`) : null;
    const to = toVal ? new Date(`${toVal}T23:59:59`) : null;
    return (row) => {
      const t = new Date(row.timestamp).getTime();
      if (from && t < from.getTime()) return false;
      if (to && t > to.getTime()) return false;
      return true;
    };
  }
  return () => true;
}

function renderHistory() {
  const tbody = document.querySelector('#historyTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const courseFilter = document.getElementById('historyCourse')?.value || '';
  const range = document.getElementById('historyRange')?.value || 'last7';
  const note = document.getElementById('historyNote');
  const downloadBtn = document.getElementById('downloadCourseHistory');

  const rangeFilter = getRangeFilter();
  let filtered = historyRows.filter((row) => {
    const key = normalizeCourseKey(row);
    if (courseFilter && key !== courseFilter) return false;
    return rangeFilter(row);
  });

  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (range === 'last7') {
    filtered = filtered.slice(0, 7);
  } else if (!courseFilter) {
    filtered = filtered.slice(0, 7);
  }

  filtered.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${idx + 1}</td><td>${formatWATDate(r.timestamp)}</td><td>${formatWATTime(r.timestamp)}</td><td>${r.course_code || r.course_name || ''}</td>`;
    tbody.appendChild(tr);
  });

  if (note) {
    if (courseFilter) {
      note.textContent = range === 'last7'
        ? 'Showing the most recent 7 attendances for the selected course.'
        : 'Showing attendance for the selected course.';
    } else {
      note.textContent = 'Showing your most recent 7 attendances across all courses.';
    }
  }

  if (downloadBtn) {
    downloadBtn.disabled = !courseFilter;
  }
}

async function loadHistory() {
  try {
    historyRows = await get(`${window.API_BASE}/student/history`);
    updateCourseOptions();
    renderHistory();
  } catch (e) {
    // ignore
  }
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  const deviceId = localStorage.getItem('deviceId');
  fetch(`${window.API_BASE}/student/logout`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ deviceId }),
  }).catch(() => {});
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  location.href = '/';
});

const historyCourse = document.getElementById('historyCourse');
const historyRange = document.getElementById('historyRange');
const historyApply = document.getElementById('historyApply');
const historyFromWrap = document.getElementById('historyFromWrap');
const historyToWrap = document.getElementById('historyToWrap');

if (historyRange) {
  historyRange.addEventListener('change', () => {
    const isCustom = historyRange.value === 'custom';
    if (historyFromWrap) historyFromWrap.style.display = isCustom ? 'flex' : 'none';
    if (historyToWrap) historyToWrap.style.display = isCustom ? 'flex' : 'none';
  });
  const isCustom = historyRange.value === 'custom';
  if (historyFromWrap) historyFromWrap.style.display = isCustom ? 'flex' : 'none';
  if (historyToWrap) historyToWrap.style.display = isCustom ? 'flex' : 'none';
}

if (historyCourse) historyCourse.addEventListener('change', renderHistory);
if (historyApply) historyApply.addEventListener('click', renderHistory);

loadProfile();
loadHistory();

async function refreshDeviceStatus() {
  const statusEl = document.getElementById('deviceStatus');
  const btn = document.getElementById('registerDeviceBtn');
  if (!statusEl || !btn) return;
  try {
    const res = await get(`${window.API_BASE}/webauthn/status`);
    if (res.registered) {
      statusEl.textContent = 'Device registered.';
      btn.disabled = true;
    } else {
      statusEl.textContent = 'No device registered. Please register your device.';
      btn.disabled = false;
    }
  } catch (e) {
    statusEl.textContent = 'Unable to check device status.';
    btn.disabled = false;
  }
}

const registerBtn = document.getElementById('registerDeviceBtn');
if (registerBtn) {
  registerBtn.addEventListener('click', async () => {
    const msg = document.getElementById('deviceMsg');
    if (msg) msg.textContent = 'Starting device registration...';
    registerBtn.disabled = true;
    try {
      const options = await post(`${window.API_BASE}/webauthn/register/start`, {});
      const publicKey = preformatCreateOptions ? preformatCreateOptions(options) : options;
      const credential = await navigator.credentials.create({ publicKey });
      const payload = {
        id: credential.id,
        rawId: bufferEncode(credential.rawId),
        type: credential.type,
        response: {
          attestationObject: bufferEncode(credential.response.attestationObject),
          clientDataJSON: bufferEncode(credential.response.clientDataJSON),
          transports: credential.response.getTransports ? credential.response.getTransports() : undefined,
        },
        clientExtensionResults: credential.getClientExtensionResults(),
      };
      await post(`${window.API_BASE}/webauthn/register/finish`, payload);
      if (msg) msg.textContent = 'Device registered successfully.';
      await refreshDeviceStatus();
    } catch (err) {
      if (msg) msg.textContent = err.message;
      registerBtn.disabled = false;
    }
  });
}

refreshDeviceStatus();

// Available courses ----------------------------------------------------------
async function loadAvailable() {
  const tbody = document.querySelector('#availTable tbody');
  tbody.innerHTML = '';
  try {
    const rows = await get(`${window.API_BASE}/student/available-courses`);
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.dataset.sessionId = r.sessionId;
      tr.innerHTML = `<td>${r.name}</td><td>${r.code}</td><td>${r.lecturer || ''}</td><td>${new Date(r.endsAt).toLocaleTimeString()}</td><td><button class="useSession" data-id="${r.sessionId}">Use</button></td>`;
      tbody.appendChild(tr);
    });
    const assign = (sid) => {
      document.getElementById('sessionId').value = sid;
      document.getElementById('submitSessionId').value = sid;
      tbody.querySelectorAll('tr').forEach((row) => row.classList.toggle('selected', row.dataset.sessionId === sid));
    };
    tbody.querySelectorAll('.useSession').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        assign(btn.getAttribute('data-id'));
      });
    });
    tbody.querySelectorAll('tr').forEach((tr) => {
      tr.addEventListener('click', () => assign(tr.dataset.sessionId));
    });
  } catch (e) {
    // ignore
  }
}

document.getElementById('refreshAvail').addEventListener('click', loadAvailable);
loadAvailable();

// grouped history download removed in favor of per-course CSV
