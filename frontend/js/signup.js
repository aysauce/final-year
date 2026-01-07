const { preformatCreateOptions, bufferEncode } = window.WebAuthnHelpers || {};

async function postJSON(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function completeRegistration(ticket, options) {
  if (!window.PublicKeyCredential) throw new Error('WebAuthn not supported on this device');
  const publicKey = preformatCreateOptions ? preformatCreateOptions(options) : options;
  const credential = await navigator.credentials.create({ publicKey });
  
  const payload = {
    id: credential.id, // browser-provided base64url
    rawId: bufferEncode(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: bufferEncode(credential.response.attestationObject),
      clientDataJSON: bufferEncode(credential.response.clientDataJSON),
      transports: credential.response.getTransports ? credential.response.getTransports() : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
  return postJSON(`${window.API_BASE}/login/register-finish`, { loginTicket: ticket, credential: payload });
}

const form = document.getElementById('signupForm');
const statusEl = document.getElementById('signupStatus');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = 'Creating account...';
  try {
    const email = document.getElementById('email').value.trim();
    const matricNumber = document.getElementById('matricNumber').value.trim();
    const password = document.getElementById('password').value;
    const res = await postJSON(`${window.API_BASE}/signup`, { email, matricNumber, password });
    if (!res.registerRequired) throw new Error('Unexpected response; please try logging in.');
    statusEl.textContent = 'Registering device...';
    const finalRes = await completeRegistration(res.loginTicket, res.options);
    localStorage.setItem('token', finalRes.token);
    localStorage.setItem('role', finalRes.role);
    statusEl.textContent = 'Success! Redirecting...';
    window.location.href = '/student.html';
  } catch (err) {
    statusEl.textContent = err.message;
  }
});
