'use strict';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitFor(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { obs.disconnect(); resolve(el); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); reject(new Error('Timeout: ' + selector)); }, timeout);
  });
}

async function doLogin() {
  const result = await chrome.storage.local.get('pendingJob');
  const pendingJob = result?.pendingJob;

  // Solo actuar si el job fue iniciado por la extensión (no login manual del usuario)
  if (!pendingJob?.openedByExtension) {
    console.log('[PJN SSO] Sin job de extensión — no intervenir');
    return;
  }

  // Job viejo (más de 10 minutos) → ignorar y limpiar
  const age = Date.now() - (pendingJob.timestamp || 0);
  if (age > 10 * 60 * 1000) {
    console.log('[PJN SSO] Job expirado, limpiando');
    chrome.storage.local.remove('pendingJob');
    return;
  }

  const { pjnUsuario, pjnPassword } = await chrome.storage.sync.get(['pjnUsuario', 'pjnPassword']);
  if (!pjnUsuario || !pjnPassword) {
    alert(
      'PJN Cargador: no hay credenciales configuradas.\n\n' +
      'Abrí la consola del service worker de la extensión y ejecutá:\n' +
      "chrome.storage.sync.set({ pjnUsuario: 'TU_CUIT', pjnPassword: 'TU_PASSWORD' })"
    );
    return;
  }

  try {
    const userInput = await waitFor('input[name="username"], #username');
    const passInput = await waitFor('input[name="password"], #password');

    userInput.value = pjnUsuario;
    userInput.dispatchEvent(new Event('input', { bubbles: true }));
    userInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);

    passInput.value = pjnPassword;
    passInput.dispatchEvent(new Event('input', { bubbles: true }));
    passInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);

    const submitBtn = await waitFor('input[type="submit"], button[type="submit"], #kc-login');
    submitBtn.click();
  } catch (err) {
    console.error('[PJN SSO]', err);
  }
}

doLogin().catch(console.error);
