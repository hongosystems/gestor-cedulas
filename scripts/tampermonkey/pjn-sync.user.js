// ==UserScript==
// @name         PJN Favoritos Sync - Gestor Cédulas
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Sincroniza expedientes favoritos del PJN con Gestor Cédulas
// @author       Gestor Cédulas
// @match        https://scw.pjn.gov.ar/scw/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      gestor-cedulas.vercel.app
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================
    // CONFIGURACIÓN
    // ============================================================
    
    // URL del backend - EDITAR SEGÚN AMBIENTE
    // Para desarrollo local: http://localhost:3000/api/pjn/sync
    // Para producción: https://gestor-cedulas.vercel.app/api/pjn/sync
    const APP_URL = 'https://gestor-cedulas.vercel.app/api/pjn/sync'; // Cambiar si es necesario
    
    const STORAGE_KEY_TOKEN = 'GESTOR_CEDULAS_SYNC_TOKEN';
    const DELAY_BETWEEN_ITEMS = 800; // ms entre cada expediente al leer detalle
    
    // ============================================================
    // FUNCIONES AUXILIARES
    // ============================================================
    
    function normalizeText(text) {
        if (!text) return '';
        return text.replace(/\u00A0/g, ' ').trim(); // Reemplazar &nbsp; y trim
    }
    
    function parseExpediente(expedienteStr) {
        // Formato: "CIV 068809/2017" o "COM 008807/2025"
        const match = expedienteStr.match(/^([A-Z]+)\s+(\d+)\/(\d{4})$/);
        if (!match) return null;
        
        const [, jurisdiccion, numero, anio] = match;
        // Mantener número como string pero sin ceros a la izquierda opcional
        // Ej: "068809" -> "68809", pero mejor mantener como viene en el sitio
        return { jurisdiccion, numero, anio };
    }
    
    function removeAsterisk(text) {
        if (!text) return '';
        return text.replace(/^\*\s*/, '').trim();
    }
    
    // ============================================================
    // GESTIÓN DE TOKEN
    // ============================================================
    
    function getToken() {
        let token = localStorage.getItem(STORAGE_KEY_TOKEN);
        if (!token) {
            token = prompt('Ingresá el token de sincronización para Gestor Cédulas:\n\n(El administrador debe configurar SYNC_TOKEN en Vercel y compartirte este valor)');
            if (token) {
                localStorage.setItem(STORAGE_KEY_TOKEN, token);
            } else {
                alert('Se necesita un token para sincronizar. Cancelando...');
                return null;
            }
        }
        return token;
    }
    
    // ============================================================
    // DETECCIÓN Y PARSEO DE TABLA DE FAVORITOS
    // ============================================================
    
    function detectFavoritosPage() {
        // Verificar que estamos en la página de favoritos
        const url = window.location.href;
        const bodyText = document.body.textContent || '';
        
        // Buscar indicadores de la página de favoritos
        const hasFavoritos = url.includes('consultaListaFavoritos') || 
                             bodyText.includes('Lista de Expedientes Favoritos') ||
                             bodyText.includes('Expediente') && bodyText.includes('Dependencia') && bodyText.includes('Carátula');
        
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
            const hasSituacion = headerTexts.some(t => t.includes('SITUACIÓN') || t.includes('SITUACION'));
            
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
    
    function parseFavoritosTable(table, includeDetail = false) {
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
        
        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
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
            
            // Buscar el ícono ojito (link al detalle)
            const detailLink = row.querySelector('a[href*="detalle"], a[href*="consultar"], a[onclick*="detalle"]') || 
                              row.querySelector('img[src*="ojito"], img[alt*="detalle"], img[alt*="ver"]');
            
            let detailUrl = null;
            if (detailLink) {
                if (detailLink.tagName === 'A') {
                    detailUrl = detailLink.href || detailLink.getAttribute('onclick')?.match(/['"]([^'"]+)['"]/)?.[1];
                } else if (detailLink.tagName === 'IMG') {
                    const parentLink = detailLink.closest('a');
                    if (parentLink) {
                        detailUrl = parentLink.href || parentLink.getAttribute('onclick')?.match(/['"]([^'"]+)['"]/)?.[1];
                    }
                }
                // Convertir URL relativa a absoluta
                if (detailUrl && !detailUrl.startsWith('http')) {
                    detailUrl = new URL(detailUrl, window.location.origin).href;
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
                source_url: detailUrl || null
            });
        }
        
        return { success: true, items };
    }
    
    // ============================================================
    // LECTURA DE DETALLE (OPCIONAL)
    // ============================================================
    
    async function fetchDetalle(url, updateCallback) {
        return new Promise((resolve, reject) => {
            if (!url) {
                resolve({ caratula: null, juzgado: null, fecha_ultima_carga: null, observaciones: null });
                return;
            }
            
            // Abrir en nueva pestaña
            const detailWindow = window.open(url, '_blank');
            
            if (!detailWindow) {
                reject(new Error('No se pudo abrir la pestaña de detalle. Verificá que los popups estén habilitados.'));
                return;
            }
            
            // Esperar a que cargue
            const checkLoad = setInterval(() => {
                try {
                    if (detailWindow.closed) {
                        clearInterval(checkLoad);
                        resolve({ caratula: null, juzgado: null, fecha_ultima_carga: null, observaciones: null });
                        return;
                    }
                    
                    if (detailWindow.document.readyState === 'complete') {
                        clearInterval(checkLoad);
                        
                        setTimeout(() => {
                            try {
                                const doc = detailWindow.document;
                                const bodyText = doc.body.textContent || '';
                                
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
                                
                                const tables = Array.from(doc.querySelectorAll('table'));
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
                                                // Validar formato DD/MM/AAAA
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
                                
                                const sourceUrl = detailWindow.location.href;
                                detailWindow.close();
                                
                                resolve({
                                    caratula,
                                    juzgado,
                                    fecha_ultima_carga,
                                    observaciones,
                                    source_url: sourceUrl
                                });
                            } catch (e) {
                                detailWindow.close();
                                reject(e);
                            }
                        }, 1500); // Delay adicional para asegurar carga completa
                    }
                } catch (e) {
                    // CORS - esperar más tiempo
                }
            }, 300);
            
            // Timeout de seguridad
            setTimeout(() => {
                clearInterval(checkLoad);
                if (detailWindow && !detailWindow.closed) {
                    detailWindow.close();
                }
                resolve({ caratula: null, juzgado: null, fecha_ultima_carga: null, observaciones: null });
            }, 30000); // 30 segundos máximo
        });
    }
    
    // ============================================================
    // ENVÍO AL BACKEND
    // ============================================================
    
    async function sendToBackend(items, token) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: APP_URL,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sync-Token': token
                },
                data: JSON.stringify({ items }),
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const data = JSON.parse(response.responseText);
                            resolve(data);
                        } catch (e) {
                            resolve({ ok: true, upserted: items.length });
                        }
                    } else {
                        try {
                            const errorData = JSON.parse(response.responseText);
                            reject(new Error(`Error ${response.status}: ${errorData.error || response.responseText}`));
                        } catch {
                            reject(new Error(`Error ${response.status}: ${response.responseText}`));
                        }
                    }
                },
                onerror: function(error) {
                    reject(new Error(`Error de red: ${error.message || 'Error desconocido'}`));
                }
            });
        });
    }
    
    // ============================================================
    // UI: BOTÓN Y FEEDBACK
    // ============================================================
    
    function createSyncButton() {
        // Buscar un lugar apropiado para inyectar el botón
        const header = document.querySelector('h1, h2, .header, [class*="header"], [id*="header"]') ||
                      document.querySelector('table')?.previousElementSibling ||
                      document.body.firstElementChild;
        
        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'gestor-cedulas-sync-container';
        buttonContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            background: white;
            border: 2px solid #0052a3;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            min-width: 280px;
        `;
        
        const title = document.createElement('div');
        title.textContent = '🔄 Sincronizar con Gestor';
        title.style.cssText = 'font-weight: 700; font-size: 14px; margin-bottom: 12px; color: #0052a3;';
        buttonContainer.appendChild(title);
        
        const checkboxContainer = document.createElement('div');
        checkboxContainer.style.cssText = 'margin-bottom: 12px;';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'gestor-cedulas-include-detail';
        checkbox.checked = true;
        checkbox.style.cssText = 'margin-right: 6px; cursor: pointer;';
        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = 'gestor-cedulas-include-detail';
        checkboxLabel.textContent = 'Traer detalle (última carga + observaciones)';
        checkboxLabel.style.cssText = 'font-size: 12px; color: #333; cursor: pointer;';
        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(checkboxLabel);
        buttonContainer.appendChild(checkboxContainer);
        
        const button = document.createElement('button');
        button.textContent = 'Sincronizar';
        button.style.cssText = `
            width: 100%;
            padding: 10px;
            background: #0052a3;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        `;
        button.onmouseenter = () => button.style.background = '#003d7a';
        button.onmouseleave = () => button.style.background = '#0052a3';
        
        const statusDiv = document.createElement('div');
        statusDiv.id = 'gestor-cedulas-status';
        statusDiv.style.cssText = 'margin-top: 12px; font-size: 12px; color: #666; min-height: 20px;';
        buttonContainer.appendChild(button);
        buttonContainer.appendChild(statusDiv);
        
        button.onclick = async () => {
            const includeDetail = checkbox.checked;
            await syncFavoritos(statusDiv, includeDetail);
        };
        
        document.body.appendChild(buttonContainer);
    }
    
    async function syncFavoritos(statusDiv, includeDetail) {
        statusDiv.style.color = '#666';
        statusDiv.textContent = 'Verificando página...';
        
        try {
            // Detectar página
            const detection = detectFavoritosPage();
            if (!detection.found) {
                statusDiv.style.color = '#e13940';
                statusDiv.textContent = `❌ ${detection.error}`;
                return;
            }
            
            // Obtener token
            const token = getToken();
            if (!token) {
                statusDiv.style.color = '#e13940';
                statusDiv.textContent = '❌ Token requerido';
                return;
            }
            
            // Parsear tabla
            statusDiv.textContent = 'Leyendo favoritos...';
            const parseResult = parseFavoritosTable(detection.table, false);
            
            if (!parseResult.success) {
                statusDiv.style.color = '#e13940';
                statusDiv.textContent = `❌ ${parseResult.error}`;
                return;
            }
            
            let items = parseResult.items;
            
            // Si incluir detalle, leer cada uno
            if (includeDetail && items.length > 0) {
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    statusDiv.textContent = `Leyendo detalle ${i + 1}/${items.length}...`;
                    
                    try {
                        const detail = await fetchDetalle(item.source_url, (msg) => {
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
            
            // Enviar al backend
            statusDiv.textContent = 'Enviando al Gestor...';
            const result = await sendToBackend(items, token);
            
            statusDiv.style.color = '#00a952';
            statusDiv.textContent = `✅ OK: ${result.upserted || items.length} registros sincronizados`;
            
        } catch (error) {
            statusDiv.style.color = '#e13940';
            statusDiv.textContent = `❌ Error: ${error.message}`;
            console.error('Error en sincronización:', error);
        }
    }
    
    // ============================================================
    // INICIALIZACIÓN
    // ============================================================
    
    function init() {
        // Esperar a que la página cargue
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(createSyncButton, 2000);
            });
        } else {
            setTimeout(createSyncButton, 2000);
        }
    }
    
    init();
})();
