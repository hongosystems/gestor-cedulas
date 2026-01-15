#!/usr/bin/env node
/**
 * Script de automatización para consulta de expedientes del Poder Judicial de la Nación
 * 
 * Uso:
 *   npm run pjn:login          - Login y guardar storageState
 *   npm run pjn:check <jurisdiccion> <numero> <anio>  - Consultar expediente y extraer actuaciones
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Configuración
const STORAGE_STATE_PATH = path.join(process.cwd(), 'pjn-storage.json');
const SNAPSHOTS_DIR = path.join(process.cwd(), 'snapshots');
const DOWNLOADS_DIR = path.join(process.cwd(), 'downloads');

// URLs
const PORTAL_URL = 'https://portalpjn.pjn.gov.ar/inicio';
const SSO_BASE = 'https://sso.pjn.gov.ar';

// Interfaces
interface Actuacion {
  fecha: string;
  tipo: string;
  descripcion_detalle: string;
  oficina: string;
  afs?: string;
  has_download: boolean;
  has_view: boolean;
  row_fingerprint: string;
}

interface ExpedienteSnapshot {
  expediente_id: string;
  sit_actual: string;
  dependencia: string;
  caratula_masked: string; // Solo primeros caracteres para identificación
  last_seen_at: string;
  actuaciones: Actuacion[];
}

// Utilidades
function maskSensitiveData(text: string, maxLength: number = 50): string {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function generateFingerprint(actuacion: Omit<Actuacion, 'row_fingerprint'>): string {
  const data = `${actuacion.fecha}|${actuacion.tipo}|${actuacion.descripcion_detalle}|${actuacion.oficina}|${actuacion.afs || ''}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

function normalizeFileName(text: string): string {
  return text.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
}

async function ensureDirectories() {
  await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
}

// Login y guardar storageState
export async function loginAndSaveSession(): Promise<void> {
  console.log('🔐 Iniciando login y guardando sesión...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Intentar ir directamente al portal
    console.log(` Navigando a ${PORTAL_URL}...`);
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // Verificar si redirige a SSO
    const currentUrl = page.url();
    if (currentUrl.includes('sso.pjn.gov.ar')) {
      console.log('🔑 Redirigido a SSO, completando login...');
      
      // Esperar a que carguen los campos
      await page.waitForSelector('input[type="text"], input[name*="user"], input[id*="user"]', { timeout: 10000 });
      
      // Obtener credenciales de variables de entorno
      const username = process.env.PJN_USER;
      const password = process.env.PJN_PASS;
      
      if (!username || !password) {
        throw new Error('PJN_USER y PJN_PASS deben estar definidas en .env');
      }

      // Buscar y llenar campo de usuario
      const userInput = page.locator('input[type="text"], input[name*="user"], input[id*="user"]').first();
      await userInput.fill(username);
      
      // Buscar y llenar campo de contraseña
      const passInput = page.locator('input[type="password"]').first();
      await passInput.fill(password);
      
      // Click en botón INGRESAR
      const loginButton = page.getByRole('button', { name: /INGRESAR|Ingresar|Login/i }).first();
      await loginButton.click();
      
      // Esperar redirección al portal
      await page.waitForURL(/portalpjn\.pjn\.gov\.ar/, { timeout: 60000 });
      console.log('✅ Login exitoso');
    } else {
      console.log('✅ Ya estamos logueados o no se requiere login');
    }

    // Guardar storageState
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log(`💾 Sesión guardada en ${STORAGE_STATE_PATH}`);
    
  } catch (error: any) {
    console.error('❌ Error en login:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Navegar al SCW desde el Portal
async function navigateToSCW(context: BrowserContext): Promise<Page> {
  console.log('🔍 Navegando al Sistema de Consulta Web...');
  
  const page = await context.newPage();
  await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 60000 });

  // Click en "Consultas" del sidebar
  const consultasLink = page.getByRole('link', { name: /Consultas/i }).or(
    page.locator('text=/Consultas/i').first()
  );
  
  // Esperar a que aparezca el link
  await consultasLink.waitFor({ timeout: 10000 });
  
  // Manejar si abre nueva pestaña o navega en la misma
  const [newPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 5000 }).catch(() => null),
    consultasLink.click()
  ]);

  let scwPage: Page;
  if (newPage) {
    console.log('📑 Nueva pestaña abierta');
    scwPage = newPage;
    await scwPage.waitForLoadState('networkidle', { timeout: 60000 });
  } else {
    console.log('📄 Navegando en la misma pestaña');
    await page.waitForURL(/scw\.pjn\.gov\.ar/, { timeout: 60000 });
    scwPage = page;
  }

  return scwPage;
}

// Hacer nueva consulta pública por expediente
async function performConsulta(
  page: Page,
  jurisdiccion: string,
  numero: string,
  anio: string
): Promise<void> {
  console.log(`🔎 Realizando consulta: ${jurisdiccion} ${numero}/${anio}...`);

  // Click en "Nueva Consulta Pública"
  const nuevaConsultaButton = page.getByRole('link', { name: /Nueva Consulta Pública/i }).or(
    page.locator('text=/Nueva Consulta Pública/i').first()
  );
  await nuevaConsultaButton.waitFor({ timeout: 10000 });
  await nuevaConsultaButton.click();
  
  await page.waitForLoadState('networkidle', { timeout: 60000 });
  await page.waitForTimeout(2000);

  // Ir a tab "Por expediente" si existe
  const expedienteTab = page.getByRole('tab', { name: /Por expediente/i }).or(
    page.locator('text=/Por expediente/i').first()
  );
  
  try {
    await expedienteTab.waitFor({ timeout: 5000 });
    await expedienteTab.click();
    await page.waitForTimeout(1000);
  } catch (e) {
    console.log('ℹ️ Tab "Por expediente" no encontrado o ya está activo');
  }

  // Seleccionar jurisdicción
  const jurisdiccionSelect = page.locator('select').first();
  await jurisdiccionSelect.waitFor({ timeout: 10000 });
  await jurisdiccionSelect.selectOption({ label: jurisdiccion });
  await page.waitForTimeout(1000);

  // Llenar número y año
  const textInputs = page.locator('input[type="text"]');
  const inputs = await textInputs.all();
  
  if (inputs.length >= 2) {
    await inputs[0].fill(numero);
    await page.waitForTimeout(500);
    await inputs[1].fill(anio);
    await page.waitForTimeout(1000);
  } else {
    throw new Error('No se encontraron los inputs de número y año');
  }

  // Click en "Consultar"
  const consultarButton = page.getByRole('button', { name: /Consultar/i }).or(
    page.locator('button:has-text("Consultar"), input[value*="Consultar"]').first()
  );
  await consultarButton.click();

  // Esperar resultados
  await page.waitForLoadState('networkidle', { timeout: 60000 });
  await page.waitForTimeout(3000);

  // Verificar si hay resultados o mensaje de error
  const bodyText = await page.textContent('body') || '';
  if (bodyText.includes('sin resultados') || bodyText.includes('no se encontraron')) {
    throw new Error('No se encontraron resultados para la consulta');
  }
}

// Extraer datos del expediente y tabla de actuaciones
async function extractExpedienteData(page: Page): Promise<ExpedienteSnapshot> {
  console.log('📊 Extrayendo datos del expediente...');

  // Esperar a que cargue la página de detalle
  await page.waitForURL(/expediente\.seam/, { timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 });
  await page.waitForTimeout(2000);

  // Extraer datos generales - usar evaluate para mayor flexibilidad
  const datosGenerales = await page.evaluate(() => {
    const result: {
      expedienteId: string;
      sitActual: string;
      dependencia: string;
      caratula: string;
    } = {
      expedienteId: '',
      sitActual: '',
      dependencia: '',
      caratula: ''
    };

    // Buscar sección "Datos Generales"
    const allElements = Array.from(document.querySelectorAll('*'));
    const datosSection = allElements.find(el => {
      const text = el.textContent || '';
      return text.includes('Datos Generales') || text.includes('DATOS GENERALES');
    });

    if (datosSection) {
      const sectionText = datosSection.textContent || '';
      const sectionHTML = datosSection.innerHTML || '';

      // Buscar Expediente
      const expMatch = sectionText.match(/Expediente[:\s]*([A-Z]{2,4}\s*\d+\/\d+)/i);
      if (expMatch) result.expedienteId = expMatch[1].trim();

      // Buscar Situación Actual
      const sitMatch = sectionText.match(/Sit\.?\s*Actual[:\s]*([^\n\r<]+)/i);
      if (sitMatch) result.sitActual = sitMatch[1].trim();

      // Buscar Dependencia
      const depMatch = sectionText.match(/Dependencia[:\s]*([^\n\r<]+)/i);
      if (depMatch) result.dependencia = depMatch[1].trim();

      // Buscar Carátula
      const carMatch = sectionText.match(/Car[áa]tula[:\s]*([^\n\r<]+)/i);
      if (carMatch) result.caratula = carMatch[1].trim();
    }

    // Si no encontramos en texto, buscar en estructura de tabla
    if (!result.expedienteId || !result.dependencia) {
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const rows = Array.from(table.querySelectorAll('tr'));
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td, th'));
          const cellTexts = cells.map(c => c.textContent?.trim() || '');

          // Buscar por headers
          const expIdx = cellTexts.findIndex(t => t.toUpperCase().includes('EXPEDIENTE'));
          if (expIdx >= 0 && expIdx + 1 < cells.length && !result.expedienteId) {
            result.expedienteId = cells[expIdx + 1]?.textContent?.trim() || '';
          }

          const depIdx = cellTexts.findIndex(t => t.toUpperCase().includes('DEPENDENCIA'));
          if (depIdx >= 0 && depIdx + 1 < cells.length && !result.dependencia) {
            result.dependencia = cells[depIdx + 1]?.textContent?.trim() || '';
          }

          const sitIdx = cellTexts.findIndex(t => t.toUpperCase().includes('SIT') && t.toUpperCase().includes('ACTUAL'));
          if (sitIdx >= 0 && sitIdx + 1 < cells.length && !result.sitActual) {
            result.sitActual = cells[sitIdx + 1]?.textContent?.trim() || '';
          }

          const carIdx = cellTexts.findIndex(t => t.toUpperCase().includes('CARÁTULA') || t.toUpperCase().includes('CARATULA'));
          if (carIdx >= 0 && carIdx + 1 < cells.length && !result.caratula) {
            result.caratula = cells[carIdx + 1]?.textContent?.trim() || '';
          }
        }
      }
    }

    return result;
  });

  // Limpiar y extraer valores reales
  const expedienteMatch = datosGenerales.expedienteId.match(/([A-Z]{2,4}\s*\d+\/\d+)/);
  const expedienteIdClean = expedienteMatch ? expedienteMatch[1] : datosGenerales.expedienteId.trim();

  // Asegurar que estamos en tab "Actuaciones"
  const actuacionesTab = page.getByRole('tab', { name: /Actuaciones/i }).or(
    page.locator('text=/Actuaciones/i').first()
  );
  
  try {
    await actuacionesTab.waitFor({ timeout: 5000 });
    await actuacionesTab.click();
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('ℹ️ Tab "Actuaciones" no encontrado o ya está activo');
  }

  // Aplicar filtro "Ver Todos" si existe
  const verTodosCheckbox = page.locator('input[type="checkbox"]').filter({ hasText: /Ver Todos/i }).or(
    page.locator('text=/Ver Todos/i').locator('..').locator('input[type="checkbox"]').first()
  );
  
  try {
    const isChecked = await verTodosCheckbox.isChecked().catch(() => false);
    if (!isChecked) {
      await verTodosCheckbox.check();
      await page.waitForTimeout(500);
    }
  } catch (e) {
    console.log('ℹ️ Checkbox "Ver Todos" no encontrado');
  }

  // Click en "Aplicar" si existe
  const aplicarButton = page.getByRole('button', { name: /Aplicar/i }).first();
  try {
    await aplicarButton.waitFor({ timeout: 3000 });
    await aplicarButton.click();
    await page.waitForTimeout(3000);
  } catch (e) {
    console.log('ℹ️ Botón "Aplicar" no encontrado o no necesario');
  }

  // Extraer tabla de actuaciones
  const table = page.locator('table').first();
  await table.waitFor({ timeout: 10000 });

  const actuaciones: Actuacion[] = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr, table tr'));
    const result: Actuacion[] = [];

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td, th'));
      if (cells.length < 4) continue;

      // Buscar columnas por headers o posición
      let fecha = '';
      let tipo = '';
      let descripcion = '';
      let oficina = '';
      let afs = '';
      let hasDownload = false;
      let hasView = false;

      // Intentar encontrar headers
      const headerRow = document.querySelector('table thead tr, table tr:first-child');
      if (headerRow) {
        const headers = Array.from(headerRow.querySelectorAll('th, td'));
        const headerTexts = headers.map(h => h.textContent?.trim().toUpperCase() || '');

        const fechaIdx = headerTexts.findIndex(h => h.includes('FECHA'));
        const tipoIdx = headerTexts.findIndex(h => h.includes('TIPO'));
        const descIdx = headerTexts.findIndex(h => h.includes('DESCRIPCIÓN') || h.includes('DESCRIPCION') || h.includes('DETALLE'));
        const oficinaIdx = headerTexts.findIndex(h => h.includes('OFICINA'));
        const afsIdx = headerTexts.findIndex(h => h.includes('A F S') || h.includes('AFS'));

        if (fechaIdx >= 0 && cells[fechaIdx]) fecha = cells[fechaIdx].textContent?.trim() || '';
        if (tipoIdx >= 0 && cells[tipoIdx]) tipo = cells[tipoIdx].textContent?.trim() || '';
        if (descIdx >= 0 && cells[descIdx]) descripcion = cells[descIdx].textContent?.trim() || '';
        if (oficinaIdx >= 0 && cells[oficinaIdx]) oficina = cells[oficinaIdx].textContent?.trim() || '';
        if (afsIdx >= 0 && cells[afsIdx]) afs = cells[afsIdx].textContent?.trim() || '';
      } else {
        // Fallback: asumir orden estándar
        if (cells.length > 0) oficina = cells[0].textContent?.trim() || '';
        if (cells.length > 1) fecha = cells[1].textContent?.trim() || '';
        if (cells.length > 2) tipo = cells[2].textContent?.trim() || '';
        if (cells.length > 3) descripcion = cells[3].textContent?.trim() || '';
        if (cells.length > 4) afs = cells[4].textContent?.trim() || '';
      }

      // Buscar botones de descarga y vista
      const downloadButton = row.querySelector('button[title*="descargar"], a[title*="descargar"], button:has(svg[class*="download"])');
      const viewButton = row.querySelector('button[title*="ver"], a[title*="ver"], button:has(svg[class*="eye"])');
      
      hasDownload = !!downloadButton;
      hasView = !!viewButton;

      // Solo agregar si tiene datos mínimos
      if (fecha || tipo || descripcion) {
        result.push({
          fecha,
          tipo,
          descripcion_detalle: descripcion,
          oficina,
          afs,
          has_download: hasDownload,
          has_view: hasView,
          row_fingerprint: '' // Se calculará después
        });
      }
    }

    return result;
  });

  // Calcular fingerprints
  actuaciones.forEach(act => {
    act.row_fingerprint = generateFingerprint(act);
  });

  const snapshot: ExpedienteSnapshot = {
    expediente_id: expedienteIdClean,
    sit_actual: datosGenerales.sitActual.replace(/Sit\.?\s*Actual[:\s]*/i, '').trim(),
    dependencia: datosGenerales.dependencia.replace(/Dependencia[:\s]*/i, '').trim(),
    caratula_masked: maskSensitiveData(datosGenerales.caratula.replace(/Car[áa]tula[:\s]*/i, '').trim()),
    last_seen_at: new Date().toISOString(),
    actuaciones
  };

  console.log(`✅ Extraídos ${actuaciones.length} actuaciones`);
  return snapshot;
}

// Comparar snapshots y detectar cambios
function detectChanges(oldSnapshot: ExpedienteSnapshot | null, newSnapshot: ExpedienteSnapshot): {
  hasChanges: boolean;
  newActuaciones: Actuacion[];
  newCedulas: Actuacion[];
} {
  if (!oldSnapshot) {
    return {
      hasChanges: true,
      newActuaciones: newSnapshot.actuaciones,
      newCedulas: newSnapshot.actuaciones.filter(a => 
        a.tipo.includes('CEDULA') || a.tipo.includes('CÉDULA')
      )
    };
  }

  const oldFingerprints = new Set(oldSnapshot.actuaciones.map(a => a.row_fingerprint));
  const newActuaciones = newSnapshot.actuaciones.filter(a => !oldFingerprints.has(a.row_fingerprint));
  const newCedulas = newActuaciones.filter(a => 
    a.tipo.includes('CEDULA') || a.tipo.includes('CÉDULA') || a.tipo.includes('EVENTO')
  );

  return {
    hasChanges: newActuaciones.length > 0,
    newActuaciones,
    newCedulas
  };
}

// Descargar PDF de una actuación
async function downloadActuacionPDF(
  page: Page,
  actuacion: Actuacion,
  expedienteId: string
): Promise<string | null> {
  if (!actuacion.has_download) {
    console.log(`⚠️ Actuación ${actuacion.fecha} ${actuacion.tipo} no tiene botón de descarga`);
    return null;
  }

  try {
    // Buscar el botón de descarga en la fila correspondiente
    const downloadButton = page.locator('table tbody tr').filter({ hasText: actuacion.fecha }).locator(
      'button[title*="descargar"], a[title*="descargar"], button:has(svg[class*="download"])'
    ).first();

    await downloadButton.waitFor({ timeout: 5000 });

    // Esperar descarga
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
      downloadButton.click()
    ]);

    if (download) {
      const fileName = `${normalizeFileName(expedienteId)}__${normalizeFileName(actuacion.fecha)}__${normalizeFileName(actuacion.tipo)}.pdf`;
      const filePath = path.join(DOWNLOADS_DIR, fileName);
      await download.saveAs(filePath);
      console.log(`📥 PDF descargado: ${filePath}`);
      return filePath;
    }
  } catch (error: any) {
    console.error(`❌ Error descargando PDF: ${error.message}`);
  }

  return null;
}

// Función principal: consultar expediente y extraer datos
export async function checkExpediente(
  jurisdiccion: string,
  numero: string,
  anio: string
): Promise<void> {
  console.log(`\n🔍 Consultando expediente: ${jurisdiccion} ${numero}/${anio}\n`);

  await ensureDirectories();

  // Cargar storageState si existe
  const browser = await chromium.launch({ headless: false });
  let context: BrowserContext;

  try {
    await fs.access(STORAGE_STATE_PATH);
    console.log('📂 Cargando sesión guardada...');
    context = await browser.newContext({
      storageState: STORAGE_STATE_PATH
    });
  } catch {
    console.log('⚠️ No se encontró storageState, iniciando sesión...');
    await browser.close();
    await loginAndSaveSession();
    const newBrowser = await chromium.launch({ headless: false });
    context = await newBrowser.newContext({
      storageState: STORAGE_STATE_PATH
    });
  }

  try {
    // Navegar al SCW
    const scwPage = await navigateToSCW(context);

    // Realizar consulta
    await performConsulta(scwPage, jurisdiccion, numero, anio);

    // Extraer datos
    const snapshot = await extractExpedienteData(scwPage);

    // Cargar snapshot anterior si existe
    const snapshotFile = path.join(SNAPSHOTS_DIR, `${normalizeFileName(snapshot.expediente_id)}.json`);
    let oldSnapshot: ExpedienteSnapshot | null = null;

    try {
      const oldData = await fs.readFile(snapshotFile, 'utf-8');
      oldSnapshot = JSON.parse(oldData);
      console.log(`📂 Snapshot anterior cargado: ${oldSnapshot.actuaciones.length} actuaciones`);
    } catch {
      console.log('📂 No se encontró snapshot anterior');
    }

    // Detectar cambios
    const changes = detectChanges(oldSnapshot, snapshot);
    
    if (changes.hasChanges) {
      console.log(`\n🆕 Cambios detectados:`);
      console.log(`   - Nuevas actuaciones: ${changes.newActuaciones.length}`);
      console.log(`   - Nuevas cédulas: ${changes.newCedulas.length}`);

      // Log de nuevas actuaciones (enmascaradas)
      changes.newActuaciones.forEach(act => {
        console.log(`   📋 ${act.fecha} | ${act.tipo} | ${maskSensitiveData(act.descripcion_detalle, 60)}`);
      });

      // Descargar PDFs de nuevas cédulas
      for (const cedula of changes.newCedulas) {
        if (cedula.has_download) {
          console.log(`\n📥 Descargando PDF de cédula: ${cedula.fecha} ${cedula.tipo}...`);
          await downloadActuacionPDF(scwPage, cedula, snapshot.expediente_id);
          await scwPage.waitForTimeout(2000);
        }
      }
    } else {
      console.log('\n✅ No hay cambios desde la última consulta');
    }

    // Guardar nuevo snapshot
    await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf-8');
    console.log(`\n💾 Snapshot guardado en ${snapshotFile}`);

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}`);
    throw error;
  } finally {
    await browser.close();
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'login') {
    loginAndSaveSession().then(() => {
      console.log('\n✅ Login completado');
      process.exit(0);
    }).catch(error => {
      console.error('\n❌ Error:', error.message);
      process.exit(1);
    });
  } else if (command === 'check') {
    const [jurisdiccion, numero, anio] = args.slice(1);
    if (!jurisdiccion || !numero || !anio) {
      console.error('Uso: npm run pjn:check <jurisdiccion> <numero> <anio>');
      console.error('Ejemplo: npm run pjn:check CNT 13056 2025');
      process.exit(1);
    }
    checkExpediente(jurisdiccion, numero, anio).then(() => {
      console.log('\n✅ Consulta completada');
      process.exit(0);
    }).catch(error => {
      console.error('\n❌ Error:', error.message);
      process.exit(1);
    });
  } else {
    console.error('Comandos disponibles:');
    console.error('  npm run pjn:login                    - Login y guardar sesión');
    console.error('  npm run pjn:check <jur> <num> <anio>  - Consultar expediente');
    process.exit(1);
  }
}
