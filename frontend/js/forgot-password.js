async function postJSON(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const requestForm = document.getElementById('requestForm');
const resetForm = document.getElementById('resetForm');
const requestLoading = document.getElementById('requestLoading');
const requestMsg = document.getElementById('requestMsg');
const requestError = document.getElementById('requestError');
const resetError = document.getElementById('resetError');

function setLoading(el, isLoading) {
  if (!el) return;
  el.classList.toggle('active', isLoading);
  el.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
}

function getSelectedRole() {
  const selected = document.querySelector('input[name="role"]:checked');
  return selected ? selected.value : 'student';
}

if (requestForm) {
  requestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    requestError.textContent = '';
    requestMsg.textContent = '';
    setLoading(requestLoading, true);
    const email = document.getElementById('email').value.trim();
    const role = getSelectedRole();
    try {
      await postJSON(`${window.API_BASE}/password/forgot`, { email, role });
      requestMsg.textContent = 'If the account exists, a reset code has been sent to your email.';
      resetForm.classList.remove('is-hidden');
      document.getElementById('resetCode').focus();
    } catch (err) {
      requestError.textContent = err.message;
    } finally {
      setLoading(requestLoading, false);
    }
  });
}

if (resetForm) {
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    resetError.textContent = '';
    const email = document.getElementById('email').value.trim();
    const role = getSelectedRole();
    const code = document.getElementById('resetCode').value.trim();
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword !== confirmPassword) {
      resetError.textContent = 'Passwords do not match.';
      return;
    }

    try {
      await postJSON(`${window.API_BASE}/password/reset`, { email, role, code, newPassword });
      window.location.href = '/';
    } catch (err) {
      resetError.textContent = err.message;
    }
  });
}

const toggleBtn = document.getElementById('toggleNewPassword');
if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    const pwd = document.getElementById('newPassword');
    if (pwd.type === 'password') {
      pwd.type = 'text';
      toggleBtn.textContent = 'Hide';
    } else {
      pwd.type = 'password';
      toggleBtn.textContent = 'Show';
    }
  });
}

const toggleConfirmBtn = document.getElementById('toggleConfirmPassword');
if (toggleConfirmBtn) {
  toggleConfirmBtn.addEventListener('click', () => {
    const pwd = document.getElementById('confirmPassword');
    if (pwd.type === 'password') {
      pwd.type = 'text';
      toggleConfirmBtn.textContent = 'Hide';
    } else {
      pwd.type = 'password';
      toggleConfirmBtn.textContent = 'Show';
    }
  });
}
