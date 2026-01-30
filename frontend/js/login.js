const WebAuthn = window.WebAuthnHelpers || {};
const { preformatCreateOptions, preformatRequestOptions, bufferEncode } = WebAuthn;

async function postJSON(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function normalizeErrorMessage(message) {
  if (!message) return 'Something went wrong. Please try again.';
  if (message.includes('The request is not allowed by the user agent') || message.includes('user denied permission')) {
    return 'Permission was denied. Please allow the request and try again.';
  }
  if (message.includes('The operation either timed out or was not allowed')) {
    return 'Request timed out or was blocked. Please try again.';
  }
  return message;
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

  function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Convert base64 strings to ArrayBuffers
  const publicKeyOptions = {
    ...options,
    challenge: base64ToArrayBuffer(options.challenge),
    allowCredentials: [
      {
        ...options.allowCredentials[0],
        id: base64ToArrayBuffer(options.allowCredentials[0].id)
      }
    ]
  };

  const credential = await navigator.credentials.get({ 
    publicKey: publicKeyOptions
  });

  return postJSON(`${window.API_BASE}/login/finish`, { loginTicket, credential });
}

const loginForm = document.getElementById('loginForm');
const loginLoading = document.getElementById('loginLoading');
const loginSubmit = loginForm ? loginForm.querySelector('button[type="submit"]') : null;
const signupCallout = document.getElementById('studentSignup');
const identifierLabel = document.getElementById('identifierLabel');
const identifierInput = document.getElementById('identifier');
const deviceIdKey = 'deviceId';

function getDeviceId() {
  let id = localStorage.getItem(deviceIdKey);
  if (!id) {
    id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(deviceIdKey, id);
  }
  return id;
}

function setLoginLoading(isLoading) {
  if (loginLoading) {
    loginLoading.classList.toggle('active', isLoading);
    loginLoading.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
  }
  if (loginSubmit) loginSubmit.disabled = isLoading;
  if (loginForm) loginForm.setAttribute('aria-busy', isLoading ? 'true' : 'false');
}

function updateSignupVisibility() {
  if (!signupCallout) return;
  const selectedRole = document.querySelector('input[name="role"]:checked');
  const isStudent = !selectedRole || selectedRole.value === 'student';
  signupCallout.classList.toggle('is-hidden', !isStudent);
  signupCallout.setAttribute('aria-hidden', isStudent ? 'false' : 'true');
}

document.querySelectorAll('input[name="role"]').forEach((input) => {
  input.addEventListener('change', () => {
    updateSignupVisibility();
    updateIdentifierFields();
  });
});
updateSignupVisibility();
updateIdentifierFields();

function updateIdentifierFields() {
  const selectedRole = document.querySelector('input[name="role"]:checked');
  const role = selectedRole ? selectedRole.value : 'student';

  if (identifierLabel) {
    if (role === 'teacher') {
      identifierLabel.textContent = 'Staff Email/Staff ID';
    } else if (role === 'admin') {
      identifierLabel.textContent = 'Email/Admin ID';
    } else {
      identifierLabel.textContent = 'Email/Matric';
    }
  }

  if (identifierInput) {
    if (role === 'admin') {
      identifierInput.removeAttribute('placeholder');
    } else if (role === 'teacher') {
      identifierInput.setAttribute('placeholder', 'e.g., lecturer@uni.edu.ng or STAFF1001');
    } else {
      identifierInput.setAttribute('placeholder', 'e.g., student@uni.edu.ng or STU1234');
    }
  }
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = document.getElementById('loginError');
    error.textContent = '';
    const identifier = document.getElementById('identifier').value.trim();
    const password = document.getElementById('password').value;
    setLoginLoading(true);

    try {
      const data = await postJSON(`${window.API_BASE}/login/start`, { identifier, password, deviceId: getDeviceId() });

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
    error.textContent = normalizeErrorMessage(err.message);
  } finally {
    setLoginLoading(false);
  }
});
}

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
