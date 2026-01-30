function authHeaders() {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function ensureAdmin() {
  if (localStorage.getItem('role') !== 'admin') {
    window.location.href = '/';
  }
}

ensureAdmin();

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  window.location.href = '/';
});

async function loadOverview() {
  const box = document.getElementById('overviewStats');
  try {
    const stats = await fetchJSON(`${window.API_BASE}/admin/overview`, { headers: authHeaders() });
    box.textContent = `Students: ${stats.students} | Teachers: ${stats.teachers} | Courses: ${stats.courses} | Active Sessions: ${stats.sessions.active}/${stats.sessions.total}`;
  } catch (e) {
    box.textContent = e.message;
  }
}

// Students -----------------------------------------------------------------
async function loadStudents() {
  const tbody = document.querySelector('#studentsTable tbody');
  tbody.innerHTML = '';
  try {
    const students = await fetchJSON(`${window.API_BASE}/admin/students`, { headers: authHeaders() });
    students.forEach((stu) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${stu.email}</td><td>${stu.matric_number || ''}</td>
        <td>
          <button data-id="${stu.id}" class="btn-reset-student">Reset Device</button>
          <button data-id="${stu.id}" class="btn-edit-student">Edit</button>
          <button data-id="${stu.id}" class="btn-del-student">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3">${e.message}</td></tr>`;
  }
}

document.getElementById('studentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('studentEmail').value.trim();
  const matricNumber = document.getElementById('studentMatric').value.trim();
  const password = document.getElementById('studentPassword').value;
  try {
    await fetchJSON(`${window.API_BASE}/admin/students`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, matricNumber, password }),
    });
    e.target.reset();
    loadStudents();
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#studentsTable').addEventListener('click', async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.classList.contains('btn-reset-student')) {
    try {
      await fetchJSON(`${window.API_BASE}/admin/students/${id}/reset-credential`, { method: 'POST', headers: authHeaders() });
      alert('Credential reset');
    } catch (err) {
      alert(err.message);
    }
  }
  if (e.target.classList.contains('btn-del-student')) {
    if (!confirm('Delete this student?')) return;
    try {
      await fetchJSON(`${window.API_BASE}/admin/students/${id}`, { method: 'DELETE', headers: authHeaders() });
      loadStudents();
    } catch (err) {
      alert(err.message);
    }
  }
  if (e.target.classList.contains('btn-edit-student')) {
    const email = prompt('New email (leave blank to skip)');
    const matric = prompt('New matric (leave blank to skip)');
    const password = prompt('New password (leave blank to skip)');
    const payload = {};
    if (email) payload.email = email;
    if (matric) payload.matricNumber = matric;
    if (password) payload.password = password;
    if (!Object.keys(payload).length) return;
    try {
      await fetchJSON(`${window.API_BASE}/admin/students/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      loadStudents();
    } catch (err) {
      alert(err.message);
    }
  }
});

// Teachers -----------------------------------------------------------------
async function loadTeachers() {
  const tbody = document.querySelector('#teachersTable tbody');
  tbody.innerHTML = '';
  try {
    const teachers = await fetchJSON(`${window.API_BASE}/admin/teachers`, { headers: authHeaders() });
    teachers.forEach((t) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.email}</td><td>${t.staff_id || ''}</td>
        <td>
          <button data-id="${t.id}" class="btn-edit-teacher">Edit</button>
          <button data-id="${t.id}" class="btn-del-teacher">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3">${e.message}</td></tr>`;
  }
}

document.getElementById('teacherForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('teacherEmail').value.trim();
  const staffId = document.getElementById('teacherStaff').value.trim();
  const password = document.getElementById('teacherPassword').value;
  try {
    await fetchJSON(`${window.API_BASE}/admin/teachers`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, staffId, password }),
    });
    e.target.reset();
    loadTeachers();
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#teachersTable').addEventListener('click', async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.classList.contains('btn-del-teacher')) {
    if (!confirm('Delete this teacher?')) return;
    try {
      await fetchJSON(`${window.API_BASE}/admin/teachers/${id}`, { method: 'DELETE', headers: authHeaders() });
      loadTeachers();
    } catch (err) {
      alert(err.message);
    }
  }
  if (e.target.classList.contains('btn-edit-teacher')) {
    const email = prompt('New email (leave blank to skip)');
    const staffId = prompt('New staff ID (leave blank to skip)');
    const password = prompt('New password (leave blank to skip)');
    const payload = {};
    if (email) payload.email = email;
    if (staffId) payload.staffId = staffId;
    if (password) payload.password = password;
    if (!Object.keys(payload).length) return;
    try {
      await fetchJSON(`${window.API_BASE}/admin/teachers/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      loadTeachers();
    } catch (err) {
      alert(err.message);
    }
  }
});

// Courses ------------------------------------------------------------------
async function loadCourses() {
  const tbody = document.querySelector('#coursesTable tbody');
  tbody.innerHTML = '';
  try {
    const courses = await fetchJSON(`${window.API_BASE}/admin/courses`, { headers: authHeaders() });
    courses.forEach((c) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${c.code}</td><td>${c.name}</td><td>${c.teacher_email || ''} (#${c.teacher_id})</td>
        <td>
          <button data-id="${c.id}" class="btn-edit-course">Edit</button>
          <button data-id="${c.id}" class="btn-del-course">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4">${e.message}</td></tr>`;
  }
}

document.getElementById('courseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('courseName').value.trim();
  const code = document.getElementById('courseCode').value.trim();
  const teacherId = Number(document.getElementById('courseTeacherId').value);
  try {
    await fetchJSON(`${window.API_BASE}/admin/courses`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name, code, teacherId }),
    });
    e.target.reset();
    loadCourses();
  } catch (err) {
    alert(err.message);
  }
});

document.querySelector('#coursesTable').addEventListener('click', async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.classList.contains('btn-del-course')) {
    if (!confirm('Delete this course?')) return;
    try {
      await fetchJSON(`${window.API_BASE}/admin/courses/${id}`, { method: 'DELETE', headers: authHeaders() });
      loadCourses();
    } catch (err) {
      alert(err.message);
    }
  }
  if (e.target.classList.contains('btn-edit-course')) {
    const name = prompt('New name');
    const code = prompt('New code');
    const teacherId = prompt('New teacher ID');
    const payload = {};
    if (name) payload.name = name;
    if (code) payload.code = code;
    if (teacherId) payload.teacherId = Number(teacherId);
    if (!Object.keys(payload).length) return;
    try {
      await fetchJSON(`${window.API_BASE}/admin/courses/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      loadCourses();
    } catch (err) {
      alert(err.message);
    }
  }
});

// Sessions -----------------------------------------------------------------
async function loadSessions() {
  const tbody = document.querySelector('#sessionsTable tbody');
  tbody.innerHTML = '';
  try {
    const sessions = await fetchJSON(`${window.API_BASE}/admin/sessions`, { headers: authHeaders() });
    sessions.forEach((s) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${s.id}</td>
        <td>${s.course_code || ''}</td>
        <td>${s.teacher_email || ''}</td>
        <td>${s.status}</td>
        <td>${new Date(s.start_time).toLocaleString()}</td>
        <td>${s.end_time ? new Date(s.end_time).toLocaleString() : '-'}</td>
        <td>
          <button data-id="${s.id}" class="btn-close-session">Close</button>
          <button data-id="${s.id}" class="btn-view-attendance">Attendance</button>
        </td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7">${e.message}</td></tr>`;
  }
}

document.querySelector('#sessionsTable').addEventListener('click', async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.classList.contains('btn-close-session')) {
    try {
      await fetchJSON(`${window.API_BASE}/admin/sessions/${id}/close`, { method: 'POST', headers: authHeaders() });
      loadSessions();
    } catch (err) {
      alert(err.message);
    }
  }
  if (e.target.classList.contains('btn-view-attendance')) {
    try {
      const rows = await fetchJSON(`${window.API_BASE}/admin/sessions/${id}/attendance`, { headers: authHeaders() });
      if (!rows.length) return alert('No attendance yet.');
      const text = rows.map((r) => `${r.email} (${r.matric_number || ''}) @ ${new Date(r.timestamp).toLocaleString()}`).join('\n');
      alert(text);
    } catch (err) {
      alert(err.message);
    }
  }
});

// Initial load
loadOverview();
loadStudents();
loadTeachers();
loadCourses();
loadSessions();
