'use strict';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitFor(selector, timeout = 20000) {
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

function waitForText(text, timeout = 20000) {
  return new Promise((resolve, reject) => {
    if (document.body.innerText.includes(text)) return resolve();
    const obs = new MutationObserver(() => {
      if (document.body.innerText.includes(text)) { obs.disconnect(); resolve(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); reject(new Error('Timeout texto: ' + text)); }, timeout);
  });
}

function waitForOptions(timeout = 8000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelectorAll('li[role="option"]');
    if (existing.length > 0) return resolve([...existing]);
    const obs = new MutationObserver(() => {
      const items = document.querySelectorAll('li[role="option"]');
      if (items.length > 0) { obs.disconnect(); resolve([...items]); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); reject(new Error('Timeout esperando opciones del dropdown')); }, timeout);
  });
}

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
  banner.innerHTML = `
    <span>${html}</span>
    <button onclick="this.parentElement.remove()"
      style="background:transparent;border:1px solid rgba(255,255,255,0.5);
      color:#fff;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:13px;margin-left:16px">
      Cerrar
    </button>`;
  document.body.prepend(banner);
}

function setReactInputValue(input, value) {
  const nativeInputSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  if (nativeInputSetter) nativeInputSetter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function run(pendingJob) {
  const jurisdiccion = pendingJob.jurisdiccion || 'CIV';
  const numero = String(pendingJob.exp_numero || (pendingJob.expNro || '').split('/')[0] || '');
  const anio   = String(pendingJob.exp_anio   || (pendingJob.expNro || '').split('/')[1] || '');
  const pdfUrl   = pendingJob.pdfUrl;
  const cedulaId = pendingJob.cedulaId;

  console.log('[PJN] datos:', { jurisdiccion, numero, anio });

  if (!numero || !anio) {
    mostrarBanner('❌ Faltan datos del expediente. Verificá pjn_favoritos.', '#c0392b');
    return;
  }

  if (!window.location.href.includes('/nuevo')) {
    window.location.href = 'https://escritos.pjn.gov.ar/nuevo';
    return;
  }

  mostrarBanner('⏳ Esperando formulario...', '#555');

  try {
    // ── Paso 1: Jurisdicción ──────────────────────────────────
    // El selector correcto es input[role="combobox"] — el primero del formulario
    const comboJur = await waitFor('input[role="combobox"]', 10000);
    await sleep(1000);

    console.log('[PJN] Abriendo dropdown jurisdicción...');
    comboJur.click();
    comboJur.focus();
    // También disparar mousedown que es lo que abre el MUI Select
    comboJur.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await sleep(800);

    // Esperar que aparezcan las opciones
    const opcJur = await waitForOptions(6000);
    console.log('[PJN] Opciones encontradas:', opcJur.length);

    const opcion = opcJur.find(o => o.textContent.toUpperCase().includes(jurisdiccion.toUpperCase()));
    if (opcion) {
      opcion.click();
      console.log('[PJN] Jurisdicción:', opcion.textContent.trim().substring(0, 40));
    } else {
      opcJur[0].click();
      console.log('[PJN] Jurisdicción fallback:', opcJur[0].textContent.trim().substring(0, 40));
    }
    await sleep(600);

    mostrarBanner('⏳ Completando número y año...', '#1a3a5c');

    // ── Número de expediente ──────────────────────────────────
    // Los inputs de número y año son input sin role especial (MuiInputBase)
    // Son los 2 inputs que siguen al combobox
    const allInputs = document.querySelectorAll('input');
    // Filtrar: no el combobox, no hidden
    const textInputs = [...allInputs].filter(i =>
      i.type !== 'hidden' &&
      i.getAttribute('role') !== 'combobox' &&
      i.offsetParent !== null
    );
    console.log('[PJN] Inputs de texto encontrados:', textInputs.length);

    // Input de número (primero visible que no es combobox)
    if (textInputs[0]) {
      textInputs[0].focus();
      await sleep(200);
      setReactInputValue(textInputs[0], numero);
      console.log('[PJN] Número seteado:', numero);
      await sleep(400);
    }

    // Input de año (segundo)
    if (textInputs[1]) {
      textInputs[1].focus();
      await sleep(200);
      setReactInputValue(textInputs[1], anio);
      console.log('[PJN] Año seteado:', anio);
      await sleep(400);
    }

    await sleep(500);
    mostrarBanner('⏳ Buscando expediente...', '#1a3a5c');

    // ── Siguiente paso 1 ──────────────────────────────────────
    const sig1 = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Siguiente');
    if (!sig1) throw new Error('No se encontró el botón Siguiente');
    sig1.click();
    console.log('[PJN] Click Siguiente paso 1');
    await sleep(4000);

    // ── Paso 2: Seleccionar expediente ────────────────────────
    await waitForText('Se han encontrado', 15000);
    await sleep(800);

    const exps = [...document.querySelectorAll('li[role="option"]')];
    console.log('[PJN] Expedientes:', exps.map(e => e.textContent.trim().substring(0, 50)));
    let elegido = false;
    for (const exp of exps) {
      if (!exp.textContent.match(/\/\d{4}\/\d+/)) { exp.click(); elegido = true; break; }
    }
    if (!elegido && exps[0]) exps[0].click();
    await sleep(500);

    const sig2 = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Siguiente');
    if (sig2) sig2.click();
    await sleep(3000);

    // ── Paso 3: Destinatario ──────────────────────────────────
    mostrarBanner('⏳ Seleccionando destinatario...', '#1a3a5c');
    // Esperar que aparezcan las opciones de destinatario
    let destOpc = [];
    try {
      destOpc = await waitForOptions(8000);
      console.log('[PJN] Destinatarios:', destOpc.length);
    } catch(_) {
      // Si no hay opciones para elegir, intentar click en Siguiente directo
      console.log('[PJN] Sin opciones de destinatario, continuando...');
    }
    if (destOpc[0]) destOpc[0].click();
    await sleep(500);

    const sig3 = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Siguiente');
    if (sig3) sig3.click();
    await sleep(3000);

    // ── Paso 4: Adjuntos ──────────────────────────────────────
    mostrarBanner('⏳ Seleccionando tipo de escrito...', '#1a3a5c');
    await sleep(800);

    // 1. Primero seleccionar ESCRITO en el dropdown
    const comboTipo = document.querySelector('input[role="combobox"]');
    if (comboTipo) {
      comboTipo.click();
      comboTipo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await sleep(800);
      const tipoOpc = await waitForOptions(5000);
      const escritoOpc = tipoOpc.find(o => o.textContent.trim() === 'ESCRITO');
      if (escritoOpc) {
        escritoOpc.click();
        console.log('[PJN] Tipo ESCRITO seleccionado');
      }
      await sleep(600);
    }

    mostrarBanner('⏳ Subiendo documento PDF...', '#1a3a5c');

    // 2. Recién ahora click en Seleccionar para subir el archivo
    const selBtn = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Seleccionar');
    if (!selBtn) throw new Error('No se encontró el botón Seleccionar');
    // NO hacer click en Seleccionar — asignar el archivo directo al input hidden
    // (click en Seleccionar requiere user activation y no funciona desde extension)

    // Obtener el PDF
    let pdfFile;
    if (pendingJob.pdfBase64) {
      const binaryStr = atob(pendingJob.pdfBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      pdfFile = new File([bytes], pendingJob.pdfNombre || `acredita-${cedulaId}.pdf`, { type: 'application/pdf' });
      console.log('[PJN] PDF desde base64, tamaño:', bytes.length);
    } else {
      // Proxy via Vercel para evitar CORS de Supabase
      const proxyUrl = pendingJob.callbackUrl
        ? pendingJob.callbackUrl.replace('/confirmar-pjn', '/pdf')
        : pdfUrl;
      console.log('[PJN] Descargando PDF desde:', proxyUrl);
      const pdfResponse = await fetch(proxyUrl);
      if (!pdfResponse.ok) throw new Error('No se pudo descargar el PDF: HTTP ' + pdfResponse.status);
      const pdfBlob = await pdfResponse.blob();
      pdfFile = new File([pdfBlob], `acredita-${cedulaId}.pdf`, { type: 'application/pdf' });
      console.log('[PJN] PDF descargado, tamaño:', pdfBlob.size);
    }

    // Asignar directo al input[type="file"] sin abrir el file dialog
    const inputFile = document.querySelector('input[type="file"]');
    if (!inputFile) throw new Error('No se encontró el input de archivo');
    const dt = new DataTransfer();
    dt.items.add(pdfFile);
    inputFile.files = dt.files;
    inputFile.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(2000);

    // Popup de descripción — esperar que aparezca
    await waitFor('[role="dialog"]', 6000).catch(() => null);
    await sleep(400);

    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      // El campo descripción es el segundo input del dialog (el primero es readonly con el nombre del archivo)
      const dialogInputs = [...dialog.querySelectorAll('input[type="text"], input:not([type="hidden"])')];
      console.log('[PJN] Inputs en dialog:', dialogInputs.length, dialogInputs.map(i => i.placeholder || i.name || i.type));
      
      // Buscar el input editable (no readonly) — es el de descripción
      const descInput = dialogInputs.find(i => !i.readOnly && !i.disabled) || dialogInputs[dialogInputs.length - 1];
      if (descInput) {
        descInput.focus();
        await sleep(200);
        setReactInputValue(descInput, 'Acredita Diligenciamiento Cedula');
        console.log('[PJN] Descripción completada');
        await sleep(400);
      }
    }

    const aceptarBtn = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Aceptar');
    if (aceptarBtn) {
      aceptarBtn.click();
      console.log('[PJN] Click Aceptar');
    }
    await sleep(1500);

    const sig4 = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Siguiente');
    if (sig4) sig4.click();
    await sleep(3000);

    // ── Paso 5: Confirmación ──────────────────────────────────
    mostrarBanner(
      '✅ <strong>Carga completada.</strong> Revisá los datos y apretá <strong>ENVIAR</strong> para confirmar.',
      '#1a3a5c'
    );

    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.textContent.trim().toUpperCase().includes('ENVIAR')) {
        await sleep(3000);
        chrome.runtime.sendMessage({ action: 'pjn_enviado' });
        mostrarBanner('✅ Presentación enviada. Podés cerrar esta pestaña.', '#1a4a2e');
        chrome.storage.local.remove('pendingJob');
      }
    }, { capture: true, once: true });

  } catch (err) {
    console.error('[PJN Escritos]', err);
    mostrarBanner('⚠️ Error: ' + err.message + ' — Continuá manualmente.', '#c0392b');
  }
}

async function main() {
  const result = await chrome.storage.local.get('pendingJob');
  const pendingJob = result?.pendingJob;
  if (!pendingJob?.openedByExtension) return;

  if (Date.now() - (pendingJob.timestamp || 0) > 15 * 60 * 1000) {
    chrome.storage.local.remove('pendingJob');
    return;
  }

  console.log('[PJN] pendingJob:', {
    jurisdiccion: pendingJob.jurisdiccion,
    exp_numero:   pendingJob.exp_numero,
    exp_anio:     pendingJob.exp_anio,
    pdfUrl:       pendingJob.pdfUrl ? 'OK' : 'FALTA'
  });

  await sleep(1500);
  run(pendingJob).catch(err => mostrarBanner('⚠️ ' + err.message, '#c0392b'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => main().catch(console.error));
} else {
  main().catch(console.error);
}
