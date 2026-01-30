const { preformatCreateOptions, bufferEncode } = window.WebAuthnHelpers || {};

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
const signupLoading = document.getElementById('signupLoading');

function setSignupLoading(isLoading) {
  if (signupLoading) {
    signupLoading.classList.toggle('active', isLoading);
    signupLoading.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
  }
  if (form) form.setAttribute('aria-busy', isLoading ? 'true' : 'false');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = 'Creating account...';
  setSignupLoading(true);
  try {
    const surname = document.getElementById('surname').value.trim();
    const firstName = document.getElementById('firstName').value.trim();
    const middleName = document.getElementById('middleName').value.trim();
    const email = document.getElementById('email').value.trim();
    const matricNumber = document.getElementById('matricNumber').value.trim();
    const password = document.getElementById('password').value;
    const res = await postJSON(`${window.API_BASE}/signup`, { surname, firstName, middleName, email, matricNumber, password });

    if (!res.registerRequired) throw new Error('Unexpected response; please try logging in.');
    statusEl.textContent = 'Registering device...';

    function base64ToArrayBuffer(base64) {
      const binaryString = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }

    if (!window.PublicKeyCredential) throw new Error('WebAuthn not supported on this device');

    // Convert base64 strings to ArrayBuffers
    const publicKeyOptions = {
      ...res.options,
      challenge: base64ToArrayBuffer(res.options.challenge),
      user: {
        ...res.options.user,
        id: base64ToArrayBuffer(res.options.user.id)
      }
    };
    
    const credential = await navigator.credentials.create({
      publicKey: publicKeyOptions
    });

    const finalRes = await postJSON(`${window.API_BASE}/login/register-finish`, { loginTicket: res.loginTicket, credential });
    localStorage.setItem('token', finalRes.token);
    localStorage.setItem('role', finalRes.role);
    statusEl.textContent = 'Success! Redirecting...';
    window.location.href = '/student.html';
  } catch (err) {
    statusEl.textContent = normalizeErrorMessage(err.message);
  } finally {
    setSignupLoading(false);
  }
});

const toggleSignupBtn = document.getElementById('toggleSignupPassword');
if (toggleSignupBtn) {
  toggleSignupBtn.addEventListener('click', () => {
    const pwd = document.getElementById('password');
    if (pwd.type === 'password') {
      pwd.type = 'text';
      toggleSignupBtn.textContent = 'Hide';
    } else {
      pwd.type = 'password';
      toggleSignupBtn.textContent = 'Show';
    }
  });
}
