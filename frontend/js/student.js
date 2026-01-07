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
    msg.textContent = 'OTP sent to your institutional email';
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
    await post(`${window.API_BASE}/student/submit-attendance`, { sessionId, otp });
    msg.textContent = 'Attendance recorded!';
    loadHistory();
  } catch (err) {
    msg.textContent = err.message;
  }
});

async function loadHistory() {
  const tbody = document.querySelector('#historyTable tbody');
  tbody.innerHTML = '';
  try {
    const rows = await get(`${window.API_BASE}/student/history`);
    rows.forEach((r, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${idx + 1}</td><td>${new Date(r.timestamp).toLocaleString()}</td><td>${r.course_code || ''}</td><td>${r.ssid}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    // ignore
  }
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.clear();
  location.href = '/';
});

loadHistory();

// Available courses ----------------------------------------------------------
async function loadAvailable() {
  const tbody = document.querySelector('#availTable tbody');
  tbody.innerHTML = '';
  try {
    const rows = await get(`${window.API_BASE}/student/available-courses`);
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.dataset.sessionId = r.sessionId;
      tr.innerHTML = `<td>${r.name}</td><td>${r.code}</td><td>${new Date(r.endsAt).toLocaleTimeString()}</td><td><button class="useSession" data-id="${r.sessionId}">Use</button></td>`;
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

// Download grouped history CSV
document.getElementById('downloadMyGrouped').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const res = await fetch(`${window.API_BASE}/student/history-grouped?format=csv`, { headers: authHeaders() });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-attendance-by-course.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    // ignore
  }
});
