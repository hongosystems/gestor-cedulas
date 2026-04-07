'use strict';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function mostrarBanner(html, color) {
  const existing = document.getElementById('pjn-cargador-banner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.id = 'pjn-cargador-banner';
  banner.style.cssText = [
    'position:fixed','top:0','left:0','right:0','z-index:99999',
    `background:${color}`,'color:#fff','padding:14px 24px',
    'font-family:sans-serif','font-size:14px',
    'display:flex','align-items:center','justify-content:space-between',
    'box-shadow:0 2px 8px rgba(0,0,0,0.3)'
  ].join(';');
  banner.innerHTML = `<span>${html}</span>`;
  document.body.prepend(banner);
}

async function main() {
  const result = await chrome.storage.local.get('pendingJob');
  const pendingJob = result?.pendingJob;
  if (!pendingJob?.openedByExtension) return;

  if (Date.now() - (pendingJob.timestamp || 0) > 15 * 60 * 1000) {
    chrome.storage.local.remove('pendingJob');
    return;
  }

  const url = window.location.href;
  console.log('[PJN Cargador] portalpjn URL:', url);

  if (url.includes('/auth/callback')) {
    mostrarBanner('⏳ Login completado. Redirigiendo...', '#555');
    await sleep(1500);
    window.location.href = 'https://portalpjn.pjn.gov.ar/inicio';
    return;
  }

  if (url.includes('/inicio')) {
    mostrarBanner('⏳ Portal cargado. Abriendo formulario de escritos...', '#1a3a5c');
    await sleep(2500);
    // Navegar directo al formulario nuevo — misma URL que el popup
    window.open('https://escritos.pjn.gov.ar/nuevo', '_blank');
    mostrarBanner('✅ Formulario abierto en nueva pestaña. Completando automáticamente...', '#1a3a5c');
    return;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => main().catch(console.error));
} else {
  main().catch(console.error);
}
