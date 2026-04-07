'use strict';

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.action !== 'cargar') {
    sendResponse({ ok: false, error: 'Acción desconocida' });
    return true;
  }

  const payload = {
    ...message.payload,
    openedByExtension: true,
    timestamp: Date.now()
  };

  chrome.storage.local.set({ pendingJob: payload }, () => {
    chrome.tabs.create({
      url:
        'https://sso.pjn.gov.ar/auth/realms/pjn/protocol/openid-connect/auth' +
        '?client_id=pjn-portal' +
        '&redirect_uri=https%3A%2F%2Fportalpjn.pjn.gov.ar%2Fauth%2Fcallback' +
        '&response_type=code&scope=openid',
      active: true
    });
  });

  sendResponse({ ok: true, status: 'abriendo_pjn' });
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'limpiar_job') {
    chrome.storage.local.remove('pendingJob');
    sendResponse({ ok: true });
    return true;
  }

  if (message.action !== 'pjn_enviado') return;

  chrome.storage.local.get('pendingJob', ({ pendingJob }) => {
    if (pendingJob?.callbackUrl) {
      fetch(pendingJob.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cedulaId: pendingJob.cedulaId })
      }).catch((err) => console.error('[PJN background] callback error:', err));
    }
    chrome.storage.local.remove('pendingJob');
  });

  sendResponse({ ok: true });
  return true;
});
