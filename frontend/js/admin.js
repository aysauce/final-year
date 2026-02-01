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

let studentsCache = [];
let studentsLoaded = false;

async function loadStudents() {
  const tbody = document.querySelector('#studentsTable tbody');
  tbody.innerHTML = '';
  try {
    studentsCache = await fetchJSON(`${window.API_BASE}/admin/students`, { headers: authHeaders() });
    studentsLoaded = true;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4">${e.message}</td></tr>`;
  }
}

function renderStudents(filter) {
  const tbody = document.querySelector('#studentsTable tbody');
  tbody.innerHTML = '';
  const needle = (filter || '').toLowerCase();
  if (!needle) {
    tbody.innerHTML = `<tr><td colspan="4">Search to view students.</td></tr>`;
    return;
  }
  studentsCache
    .filter((s) => {
      const name = [s.surname, s.first_name, s.middle_name].filter(Boolean).join(' ').toLowerCase();
      const email = String(s.email || '').toLowerCase();
      const matric = String(s.matric_number || '').toLowerCase();
      return !needle || name.includes(needle) || email.includes(needle) || matric.includes(needle);
    })
    .forEach((stu) => {
      const tr = document.createElement('tr');
      const name = [stu.surname, stu.first_name, stu.middle_name].filter(Boolean).join(' ');
      tr.innerHTML = `<td>${name}</td><td>${stu.email}</td><td>${stu.matric_number || ''}</td>
        <td><button data-id="${stu.id}" class="btn-reset-student">Reset Device</button></td>`;
      tbody.appendChild(tr);
    });
}

document.querySelector('#studentsTable').addEventListener('click', async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.classList.contains('btn-reset-student')) {
    if (!confirm('Reset this student device?')) return;
    try {
      await fetchJSON(`${window.API_BASE}/admin/students/${id}/reset-credential`, { method: 'POST', headers: authHeaders() });
      alert('Device reset. Student can re-register.');
    } catch (err) {
      alert(err.message);
    }
  }
});

const searchInput = document.getElementById('studentSearch');
if (searchInput) {
  searchInput.addEventListener('input', async (e) => {
    const value = e.target.value;
    if (!studentsLoaded && value.trim()) {
      await loadStudents();
    }
    renderStudents(value);
  });
}

renderStudents('');
