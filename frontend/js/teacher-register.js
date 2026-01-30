async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const form = document.getElementById('teacherRegisterForm');
const statusEl = document.getElementById('teacherRegisterStatus');
const toggleTeacherBtn = document.getElementById('toggleTeacherPassword');

if (toggleTeacherBtn) {
  toggleTeacherBtn.addEventListener('click', () => {
    const pwd = document.getElementById('teacherPassword');
    if (pwd.type === 'password') {
      pwd.type = 'text';
      toggleTeacherBtn.textContent = 'Hide';
    } else {
      pwd.type = 'password';
      toggleTeacherBtn.textContent = 'Show';
    }
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = 'Creating teacher account...';
  const surname = document.getElementById('teacherSurname').value.trim();
  const firstName = document.getElementById('teacherFirstName').value.trim();
  const middleName = document.getElementById('teacherMiddleName').value.trim();
  const title = document.getElementById('teacherTitle').value;
  const sex = document.getElementById('teacherSex').value;
  const email = document.getElementById('teacherEmail').value.trim();
  const staffId = document.getElementById('teacherStaffId').value.trim();
  const password = document.getElementById('teacherPassword').value;
  try {
    const res = await fetchJSON(`${window.API_BASE}/teacher-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surname, firstName, middleName, title, sex, email, staffId, password }),
    });
    if (res && res.token) {
      localStorage.setItem('token', res.token);
      localStorage.setItem('role', res.role);
      window.location.href = '/teacher.html';
      return;
    }
    form.reset();
    statusEl.textContent = 'Teacher account created. You can now log in.';
  } catch (err) {
    statusEl.textContent = err.message;
  }
});
