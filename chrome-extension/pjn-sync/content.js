// Content script para sincronizar favoritos PJN con Gestor Cédulas

(function() {
  'use strict';

  const DELAY_BETWEEN_ITEMS = 600; // ms entre cada expediente al leer detalle

  // ============================================================
  // FUNCIONES AUXILIARES
  // ============================================================

  function normalizeText(text) {
    if (!text) return '';
    return text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseExpediente(expedienteStr) {
    // Formato: "CIV 068809/2017" o "COM 008807/2025"
    const match = expedienteStr.match(/^([A-Z]+)\s+(\d+)\/(\d{4})$/);
    if (!match) return null;
    
    const [, jurisdiccion, numero, anio] = match;
    return { jurisdiccion, numero, anio };
  }

  function removeAsterisk(text) {
    if (!text) return '';
    return text.replace(/^\*\s*/, '').trim();
  }

  // ============================================================
  // DETECCIÓN Y PARSEO DE TABLA DE FAVORITOS
  // ============================================================

  function detectFavoritosPage() {
    const url = window.location.href;
    const bodyText = document.body.textContent || '';
    
    // Buscar indicadores de la página de favoritos
    const hasFavoritos = url.includes('consultaListaFavoritos') || 
                         bodyText.includes('Lista de Expedientes Favoritos') ||
                         bodyText.includes('Expedientes Favoritos');
    
    if (!hasFavoritos) {
      return { found: false, error: 'No se detectó la pantalla "Lista de Expedientes Favoritos". Asegurate de estar en la página correcta.' };
    }
    
    // Buscar tabla con expedientes
    const tables = Array.from(document.querySelectorAll('table'));
    let targetTable = null;
    
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length < 2) continue;
      
      // Buscar header con columnas esperadas
      const headerRow = rows[0];
      const headerCells = Array.from(headerRow.querySelectorAll('td, th'));
      const headerTexts = headerCells.map(cell => normalizeText(cell.textContent || '')).map(t => t.toUpperCase());
      
      const hasExpediente = headerTexts.some(t => t.includes('EXPEDIENTE'));
      const hasDependencia = headerTexts.some(t => t.includes('DEPENDENCIA') || t.includes('JUZGADO'));
      const hasCaratula = headerTexts.some(t => t.includes('CARÁTULA') || t.includes('CARATULA'));
      
      if (hasExpediente && (hasDependencia || hasCaratula)) {
        targetTable = table;
        break;
      }
    }
    
    if (!targetTable) {
      return { found: false, error: 'No se encontró la tabla de favoritos. Verificá que la página esté completamente cargada.' };
    }
    
    return { found: true, table: targetTable };
  }

  function parseFavoritosTable(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) {
      return { success: false, error: 'La tabla no tiene suficientes filas' };
    }
    
    const headerRow = rows[0];
    const headerCells = Array.from(headerRow.querySelectorAll('td, th'));
    const headerTexts = headerCells.map(cell => normalizeText(cell.textContent || ''));
    
    // Identificar índices de columnas
    const expedienteIdx = headerTexts.findIndex(t => t.toUpperCase().includes('EXPEDIENTE'));
    const dependenciaIdx = headerTexts.findIndex(t => t.toUpperCase().includes('DEPENDENCIA') || t.toUpperCase().includes('JUZGADO'));
    const caratulaIdx = headerTexts.findIndex(t => t.toUpperCase().includes('CARÁTULA') || t.toUpperCase().includes('CARATULA'));
    
    if (expedienteIdx === -1) {
      return { success: false, error: 'No se encontró la columna "Expediente" en la tabla' };
    }
    
    const items = [];
    const dataRows = rows.slice(1); // Saltar header
    
    for (const row of dataRows) {
      const cells = Array.from(row.querySelectorAll('td, th'));
      
      if (cells.length < Math.max(expedienteIdx, dependenciaIdx, caratulaIdx) + 1) {
        continue; // Fila incompleta
      }
      
      const expedienteText = normalizeText(cells[expedienteIdx]?.textContent || '');
      const parsed = parseExpediente(expedienteText);
      
      if (!parsed) {
        console.warn('No se pudo parsear expediente:', expedienteText);
        continue;
      }
      
      const juzgado = dependenciaIdx >= 0 ? normalizeText(cells[dependenciaIdx]?.textContent || '') : '';
      const caratulaRaw = caratulaIdx >= 0 ? normalizeText(cells[caratulaIdx]?.textContent || '') : '';
      const caratula = removeAsterisk(caratulaRaw);
      
      // Buscar el link al detalle (ojito) - múltiples estrategias
      let detailLink = null;
      
      // Estrategia 1: Buscar <a> con href que contenga "detalle" o "consultar"
      const links = Array.from(row.querySelectorAll('a'));
      detailLink = links.find(a => {
        const href = a.getAttribute('href') || '';
        const onclick = a.getAttribute('onclick') || '';
        return href.includes('detalle') || href.includes('consultar') || 
               onclick.includes('detalle') || onclick.includes('consultar');
      });
      
      // Estrategia 2: Buscar imagen "ojito" y su parent link
      if (!detailLink) {
        const images = Array.from(row.querySelectorAll('img'));
        const ojitoImg = images.find(img => {
          const src = img.getAttribute('src') || '';
          const alt = img.getAttribute('alt') || '';
          return src.includes('ojito') || src.includes('ver') || src.includes('detalle') ||
                 alt.toLowerCase().includes('ver') || alt.toLowerCase().includes('detalle');
        });
        if (ojitoImg) {
          detailLink = ojitoImg.closest('a') || ojitoImg.parentElement;
        }
      }
      
      // Estrategia 3: Buscar botón con onclick que abra detalle
      if (!detailLink) {
        const buttons = Array.from(row.querySelectorAll('button, input[type="button"]'));
        detailLink = buttons.find(btn => {
          const onclick = btn.getAttribute('onclick') || '';
          return onclick.includes('detalle') || onclick.includes('consultar');
        });
      }
      
      let detailUrl = null;
      if (detailLink) {
        if (detailLink.tagName === 'A') {
          detailUrl = detailLink.href || detailLink.getAttribute('onclick')?.match(/['"]([^'"]+)['"]/)?.[1];
        } else if (detailLink.tagName === 'BUTTON' || detailLink.tagName === 'INPUT') {
          const onclick = detailLink.getAttribute('onclick') || '';
          const match = onclick.match(/['"]([^'"]+)['"]/);
          detailUrl = match ? match[1] : null;
        }
        
        // Convertir URL relativa a absoluta
        if (detailUrl && !detailUrl.startsWith('http')) {
          try {
            detailUrl = new URL(detailUrl, window.location.origin).href;
          } catch {
            detailUrl = null;
          }
        }
      }
      
      items.push({
        jurisdiccion: parsed.jurisdiccion,
        numero: parsed.numero,
        anio: parsed.anio,
        caratula: caratula,
        juzgado: juzgado,
        fecha_ultima_carga: null,
        observaciones: null,
        source_url: detailUrl || null,
        detailLink: detailLink // Guardamos el elemento para hacer click después
      });
    }
    
    return { success: true, items };
  }

  // ============================================================
  // LECTURA DE DETALLE (OPCIONAL)
  // ============================================================

  async function fetchDetalleFromNavigation(detailLink, updateCallback) {
    return new Promise((resolve, reject) => {
      if (!detailLink) {
        resolve({ caratula: null, juzgado: null, fecha_ultima_carga: null, observaciones: null });
        return;
      }
      
      updateCallback('Abriendo detalle...');
      
      // Simular click y esperar navegación
      const currentUrl = window.location.href;
      
      // Listener para detectar cambio de URL
      const checkNavigation = setInterval(() => {
        if (window.location.href !== currentUrl) {
          clearInterval(checkNavigation);
          
          // Esperar a que cargue la nueva página
          const checkLoad = setInterval(() => {
            if (document.readyState === 'complete') {
              clearInterval(checkLoad);
              
              setTimeout(() => {
                try {
                  const bodyText = document.body.textContent || '';
                  
                  // Extraer Carátula de "Datos Generales"
                  let caratula = null;
                  const caratulaMatch = bodyText.match(/Car[áa]tula[:\s]*\*?\s*([^\n\r]+)/i);
                  if (caratulaMatch && caratulaMatch[1]) {
                    caratula = removeAsterisk(normalizeText(caratulaMatch[1]));
                  }
                  
                  // Extraer Dependencia
                  let juzgado = null;
                  const depMatch = bodyText.match(/Dependencia[:\s]+([^\n\r]+)/i);
                  if (depMatch && depMatch[1]) {
                    juzgado = normalizeText(depMatch[1]);
                  }
                  
                  // Buscar tabla de Actuaciones - PRIMERA FILA VISIBLE
                  let fecha_ultima_carga = null;
                  let observaciones = null;
                  
                  const tables = Array.from(document.querySelectorAll('table'));
                  for (const table of tables) {
                    const rows = Array.from(table.querySelectorAll('tr'));
                    if (rows.length < 2) continue;
                    
                    const headerRow = rows[0];
                    const headers = Array.from(headerRow.querySelectorAll('td, th'));
                    const headerTexts = headers.map(h => normalizeText(h.textContent || '').toUpperCase());
                    
                    const hasFecha = headerTexts.some(h => h.includes('FECHA'));
                    const hasDesc = headerTexts.some(h => h.includes('DESCRIPCION') || h.includes('DESCRIPCIÓN') || h.includes('DETALLE'));
                    
                    if (hasFecha || hasDesc) {
                      const fechaIdx = headerTexts.findIndex(h => h.includes('FECHA'));
                      const descIdx = headerTexts.findIndex(h => h.includes('DESCRIPCION') || h.includes('DESCRIPCIÓN') || h.includes('DETALLE'));
                      
                      // PRIMERA FILA DE DATOS (índice 1, después del header)
                      if (rows.length > 1) {
                        const firstDataRow = rows[1];
                        const cells = Array.from(firstDataRow.querySelectorAll('td, th'));
                        
                        if (fechaIdx >= 0 && cells[fechaIdx]) {
                          const fechaText = normalizeText(cells[fechaIdx].textContent || '');
                          if (/^\d{2}\/\d{2}\/\d{4}/.test(fechaText)) {
                            fecha_ultima_carga = fechaText;
                          }
                        }
                        
                        if (descIdx >= 0 && cells[descIdx]) {
                          const descText = normalizeText(cells[descIdx].textContent || '');
                          if (descText && descText.length > 0) {
                            observaciones = descText;
                          }
                        }
                      }
                      
                      break;
                    }
                  }
                  
                  const sourceUrl = window.location.href;
                  
                  // Volver a la lista de favoritos
                  updateCallback('Volviendo a la lista...');
                  
                  // Buscar botón "Volver" o usar history.back()
                  const backButton = Array.from(document.querySelectorAll('a, button')).find(el => {
                    const text = normalizeText(el.textContent || '');
                    return text.includes('Volver') || text.includes('Lista') || text.includes('Favoritos');
                  });
                  
                  if (backButton && backButton.tagName === 'A') {
                    backButton.click();
                  } else if (backButton && backButton.tagName === 'BUTTON') {
                    backButton.click();
                  } else {
                    window.history.back();
                  }
                  
                  // Esperar a que vuelva a cargar la lista
                  setTimeout(() => {
                    resolve({
                      caratula,
                      juzgado,
                      fecha_ultima_carga,
                      observaciones,
                      source_url: sourceUrl
                    });
                  }, 2000);
                  
                } catch (e) {
                  window.history.back();
                  reject(e);
                }
              }, 1500);
            }
          }, 200);
          
          // Timeout de seguridad
          setTimeout(() => {
            clearInterval(checkLoad);
            window.history.back();
            resolve({ caratula: null, juzgado: null, fecha_ultima_carga: null, observaciones: null });
          }, 30000);
        }
      }, 300);
      
      // Hacer click en el link
      try {
        if (detailLink.tagName === 'A') {
          detailLink.click();
        } else if (detailLink.tagName === 'BUTTON' || detailLink.tagName === 'INPUT') {
          detailLink.click();
        } else {
          // Intentar encontrar y clickear el parent link
          const parentLink = detailLink.closest('a');
          if (parentLink) {
            parentLink.click();
          } else {
            reject(new Error('No se pudo hacer click en el link de detalle'));
          }
        }
      } catch (e) {
        clearInterval(checkNavigation);
        reject(e);
      }
      
      // Timeout general
      setTimeout(() => {
        clearInterval(checkNavigation);
        resolve({ caratula: null, juzgado: null, fecha_ultima_carga: null, observaciones: null });
      }, 35000);
    });
  }

  // ============================================================
  // ENVÍO AL BACKEND
  // ============================================================

  async function sendToBackend(items, appUrl, syncToken, updateCallback) {
    updateCallback('Enviando al Gestor...');
    
    try {
      const response = await fetch(`${appUrl}/api/pjn/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sync-Token': syncToken
        },
        body: JSON.stringify({ items })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Error ${response.status}`);
      }

      return data;
    } catch (error) {
      throw new Error(`Error de red: ${error.message}`);
    }
  }

  // ============================================================
  // UI: BOTÓN Y FEEDBACK
  // ============================================================

  function createSyncButton() {
    // Evitar duplicados
    if (document.getElementById('gestor-cedulas-sync-container')) {
      return;
    }

    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'gestor-cedulas-sync-container';
    buttonContainer.innerHTML = `
      <div class="gestor-sync-header">
        <span>🔄 Sincronizar con Gestor</span>
      </div>
      <div class="gestor-sync-body">
        <label class="gestor-sync-checkbox">
          <input type="checkbox" id="gestor-cedulas-include-detail" checked />
          <span>Traer detalle (última carga + observaciones)</span>
        </label>
        <button id="gestor-cedulas-sync-btn" class="gestor-sync-button">Sincronizar</button>
        <div id="gestor-cedulas-status" class="gestor-sync-status"></div>
      </div>
    `;

    document.body.appendChild(buttonContainer);

    // Event listener para el botón
    document.getElementById('gestor-cedulas-sync-btn').addEventListener('click', async () => {
      await syncFavoritos();
    });
  }

  async function syncFavoritos() {
    const statusDiv = document.getElementById('gestor-cedulas-status');
    const button = document.getElementById('gestor-cedulas-sync-btn');
    const includeDetail = document.getElementById('gestor-cedulas-include-detail').checked;

    // Obtener configuración
    const { appUrl, syncToken } = await chrome.storage.local.get(['appUrl', 'syncToken']);

    statusDiv.className = 'gestor-sync-status';
    button.disabled = true;

    try {
      if (!appUrl || !syncToken) {
        statusDiv.className = 'gestor-sync-status error';
        statusDiv.textContent = '❌ Configurá la extensión primero. Click derecho en el ícono → Opciones';
        button.disabled = false;
        return;
      }

      statusDiv.textContent = 'Verificando página...';
      statusDiv.className = 'gestor-sync-status';

      // Detectar página
      const detection = detectFavoritosPage();
      if (!detection.found) {
        statusDiv.className = 'gestor-sync-status error';
        statusDiv.textContent = `❌ ${detection.error}`;
        button.disabled = false;
        return;
      }

      // Parsear tabla
      statusDiv.textContent = 'Leyendo favoritos...';
      const parseResult = parseFavoritosTable(detection.table);

      if (!parseResult.success) {
        statusDiv.className = 'gestor-sync-status error';
        statusDiv.textContent = `❌ ${parseResult.error}`;
        button.disabled = false;
        return;
      }

      let items = parseResult.items;

      if (items.length === 0) {
        statusDiv.className = 'gestor-sync-status error';
        statusDiv.textContent = '❌ No se encontraron expedientes en la tabla';
        button.disabled = false;
        return;
      }

      // Si incluir detalle, leer cada uno
      if (includeDetail && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          statusDiv.textContent = `Leyendo detalle ${i + 1}/${items.length}...`;
          statusDiv.className = 'gestor-sync-status';

          try {
            const detail = await fetchDetalleFromNavigation(item.detailLink, (msg) => {
              statusDiv.textContent = msg;
            });

            // Actualizar item con detalle
            if (detail.caratula) item.caratula = detail.caratula;
            if (detail.juzgado) item.juzgado = detail.juzgado;
            if (detail.fecha_ultima_carga) item.fecha_ultima_carga = detail.fecha_ultima_carga;
            if (detail.observaciones) item.observaciones = detail.observaciones;
            if (detail.source_url) item.source_url = detail.source_url;

            // Delay entre items
            if (i < items.length - 1) {
              await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ITEMS));
            }
          } catch (e) {
            console.warn(`Error leyendo detalle ${i + 1}:`, e);
            // Continuar con siguiente aunque falle uno
          }
        }
      }

      // Remover detailLink del payload
      const payloadItems = items.map(({ detailLink, ...rest }) => rest);

      // Enviar al backend
      const result = await sendToBackend(payloadItems, appUrl, syncToken, (msg) => {
        statusDiv.textContent = msg;
      });

      statusDiv.className = 'gestor-sync-status success';
      statusDiv.textContent = `✅ OK: ${result.upserted || payloadItems.length} registros sincronizados`;

    } catch (error) {
      statusDiv.className = 'gestor-sync-status error';
      statusDiv.textContent = `❌ Error: ${error.message}`;
      console.error('Error en sincronización:', error);
    } finally {
      button.disabled = false;
    }
  }

  // ============================================================
  // AUTO-SYNC: Sincronización automática sin UI
  // ============================================================

  async function autoSync() {
    // Obtener configuración
    const { appUrl, syncToken } = await chrome.storage.local.get(['appUrl', 'syncToken']);

    if (!appUrl || !syncToken) {
      console.warn('Gestor Cédulas: No hay configuración. Sincronización automática cancelada.');
      return;
    }

    // Detectar página
    const detection = detectFavoritosPage();
    if (!detection.found) {
      console.warn('Gestor Cédulas: No se detectó página de favoritos.');
      return;
    }

    // Parsear tabla
    const parseResult = parseFavoritosTable(detection.table);
    if (!parseResult.success) {
      console.error('Gestor Cédulas: Error parseando tabla:', parseResult.error);
      return;
    }

    let items = parseResult.items;
    if (items.length === 0) {
      console.warn('Gestor Cédulas: No hay expedientes para sincronizar.');
      return;
    }

    // Leer detalles automáticamente (opcional, más lento pero más completo)
    const includeDetail = true; // Por defecto incluir detalles
    if (includeDetail) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const detail = await fetchDetalleFromNavigation(item.detailLink, () => {});
          if (detail.caratula) item.caratula = detail.caratula;
          if (detail.juzgado) item.juzgado = detail.juzgado;
          if (detail.fecha_ultima_carga) item.fecha_ultima_carga = detail.fecha_ultima_carga;
          if (detail.observaciones) item.observaciones = detail.observaciones;
          if (detail.source_url) item.source_url = detail.source_url;
          if (i < items.length - 1) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ITEMS));
          }
        } catch (e) {
          console.warn(`Error leyendo detalle ${i + 1}:`, e);
        }
      }
    }

    // Remover detailLink del payload
    const payloadItems = items.map(({ detailLink, ...rest }) => rest);

    // Enviar al backend silenciosamente
    try {
      const result = await sendToBackend(payloadItems, appUrl, syncToken, () => {});
      
      // Notificar al usuario con una notificación del navegador
      try {
        chrome.runtime.sendMessage({
          action: 'notify-sync-complete',
          count: result.upserted || payloadItems.length
        });
      } catch (e) {
        // Ignorar si no se puede enviar mensaje
      }
      
      console.log(`Gestor Cédulas: Sincronizados ${result.upserted || payloadItems.length} expedientes.`);
    } catch (error) {
      console.error('Gestor Cédulas: Error sincronizando:', error);
      try {
        chrome.runtime.sendMessage({
          action: 'notify-sync-error',
          error: error.message
        });
      } catch (e) {
        // Ignorar si no se puede enviar mensaje
      }
    }
  }

  // ============================================================
  // INICIALIZACIÓN
  // ============================================================

  function init() {
    // Verificar si debe hacer auto-sync
    const urlParams = new URLSearchParams(window.location.search);
    const shouldAutoSync = urlParams.get('autoSync') === 'true';

    if (shouldAutoSync) {
      // Esperar a que la página cargue y sincronizar automáticamente
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setTimeout(autoSync, 2000);
        });
      } else {
        setTimeout(autoSync, 2000);
      }
    } else {
      // Modo normal: mostrar botón
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setTimeout(createSyncButton, 1500);
        });
      } else {
        setTimeout(createSyncButton, 1500);
      }
    }

    // Escuchar eventos de auto-sync desde background script
    window.addEventListener('gestor-cedulas-auto-sync', () => {
      autoSync();
    });

    // Re-crear botón si la página cambia (SPA navigation)
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        const newParams = new URLSearchParams(window.location.search);
        if (newParams.get('autoSync') === 'true') {
          setTimeout(autoSync, 1500);
        } else {
          setTimeout(createSyncButton, 1500);
        }
      }
    }, 1000);
  }

  init();
})();
