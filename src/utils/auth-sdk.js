const scripts = new Map();

export function loadAuthScript(key, src, { documentTarget = globalThis.document, timeoutMs = 12_000 } = {}) {
  if (scripts.has(key)) return scripts.get(key);
  const promise = new Promise((resolve, reject) => {
    if (!documentTarget) {
      reject(new Error('Sign-in is only available in a browser.'));
      return;
    }
    const existing = documentTarget.querySelector(`script[data-auth-sdk="${key}"]`);
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    const script = existing || documentTarget.createElement('script');
    let settled = false;
    let timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
      if (error) {
        script.remove();
        reject(error);
      } else {
        script.dataset.loaded = 'true';
        resolve();
      }
    };
    const loaded = () => finish();
    const failed = () => finish(new Error('Google sign-in could not load. Please try again.'));
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    timer = setTimeout(() => finish(new Error('Google sign-in took too long to load. Please try again.')), timeoutMs);
    if (!existing) {
      script.src = src;
      script.async = true;
      script.defer = true;
      script.dataset.authSdk = key;
      documentTarget.head.appendChild(script);
    }
  }).catch((error) => {
    if (scripts.get(key) === promise) scripts.delete(key);
    throw error;
  });
  scripts.set(key, promise);
  return promise;
}
