(function () {
  function bufferDecode(value) {
    const str = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = str.padEnd(str.length + ((4 - (str.length % 4 || 4)) % 4), '=');
    const decoded = atob(pad);
    const arrayBuffer = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) {
      arrayBuffer[i] = decoded.charCodeAt(i);
    }
    return arrayBuffer;
  }

  function bufferEncode(value) {
    return btoa(String.fromCharCode(...new Uint8Array(value)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function preformatCreateOptions(options) {
    return {
      ...options,
      challenge: bufferDecode(options.challenge),
      user: {
        ...options.user,
        id: bufferDecode(options.user.id),
      },
      excludeCredentials: (options.excludeCredentials || []).map((cred) => ({
        ...cred,
        id: bufferDecode(cred.id),
      })),
    };
  }

  function preformatRequestOptions(options) {
    return {
      ...options,
      challenge: bufferDecode(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((cred) => ({
        ...cred,
        id: bufferDecode(cred.id),
      })),
    };
  }

  window.WebAuthnHelpers = {
    bufferDecode,
    bufferEncode,
    preformatCreateOptions,
    preformatRequestOptions,
  };
})();
(function () {
  function bufferDecode(value) {
    const str = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = str.padEnd(str.length + ((4 - (str.length % 4 || 4)) % 4), '=');
    const decoded = atob(pad);
    const arrayBuffer = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) {
      arrayBuffer[i] = decoded.charCodeAt(i);
    }
    return arrayBuffer;
  }

  function bufferEncode(value) {
    // Handle different input types
    let bytes;
    
    if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else if (value instanceof Uint8Array) {
      bytes = value;
    } else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
      // Fallback for unexpected types
      console.error('Unexpected value type in bufferEncode:', value);
      bytes = new Uint8Array(0);
    }

    // Convert to base64url
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function preformatCreateOptions(options) {
    return {
      ...options,
      challenge: bufferDecode(options.challenge),
      user: {
        ...options.user,
        id: bufferDecode(options.user.id),
      },
      excludeCredentials: (options.excludeCredentials || []).map((cred) => ({
        ...cred,
        id: bufferDecode(cred.id),
      })),
    };
  }

  function preformatRequestOptions(options) {
    return {
      ...options,
      challenge: bufferDecode(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((cred) => ({
        ...cred,
        id: bufferDecode(cred.id),
      })),
    };
  }

  window.WebAuthnHelpers = {
    bufferDecode,
    bufferEncode,
    preformatCreateOptions,
    preformatRequestOptions,
  };
})();