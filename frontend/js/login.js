const WebAuthn = window.WebAuthnHelpers || {};
const { preformatCreateOptions, preformatRequestOptions, bufferEncode } = WebAuthn;

async function postJSON(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function completeLogin(payload) {
  localStorage.setItem('token', payload.token);
  localStorage.setItem('role', payload.role);
  if (payload.role === 'admin') {
    window.location.href = '/admin.html';
  } else if (payload.role === 'teacher') {
    window.location.href = '/teacher.html';
  } else {
    window.location.href = '/student.html';
  }
}

async function finishRegistration(loginTicket, options) {
  if (!window.PublicKeyCredential) throw new Error('WebAuthn not supported');
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
  return postJSON(`${window.API_BASE}/login/register-finish`, { loginTicket, credential: payload });
}

async function finishAuthentication(loginTicket, options) {
  if (!window.PublicKeyCredential) throw new Error('WebAuthn not supported');
  const publicKey = preformatRequestOptions ? preformatRequestOptions(options) : options;
  const assertion = await navigator.credentials.get({ publicKey });
  
  const payload = {
    id: assertion.id, // browser-provided base64url
    rawId: bufferEncode(assertion.rawId),
    type: assertion.type,
    response: {
      authenticatorData: bufferEncode(assertion.response.authenticatorData),
      clientDataJSON: bufferEncode(assertion.response.clientDataJSON),
      signature: bufferEncode(assertion.response.signature),
      userHandle: assertion.response.userHandle ? bufferEncode(assertion.response.userHandle) : null,
    },
    clientExtensionResults: assertion.getClientExtensionResults(),
  };
  return postJSON(`${window.API_BASE}/login/finish`, { loginTicket, credential: payload });
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = document.getElementById('loginError');
  error.textContent = '';
  const identifier = document.getElementById('identifier').value.trim();
  const password = document.getElementById('password').value;

  try {
    const data = await postJSON(`${window.API_BASE}/login/start`, { identifier, password });

    if (data.loginComplete) {
      completeLogin(data);
      return;
    }
    if (data.registerRequired) {
      const res = await finishRegistration(data.loginTicket, data.options);
      completeLogin(res);
      return;
    }
    if (data.webauthnRequired) {
      const res = await finishAuthentication(data.loginTicket, data.options);
      completeLogin(res);
      return;
    }
    throw new Error('Unexpected response from server');
  } catch (err) {
    console.log(err);
    error.textContent = err.message;
  }
});

const toggleBtn = document.getElementById('togglePassword');
if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    const pwd = document.getElementById('password');
    if (pwd.type === 'password') {
      pwd.type = 'text';
      toggleBtn.textContent = 'Hide';
    } else {
      pwd.type = 'password';
      toggleBtn.textContent = 'Show';
    }
  });
}
