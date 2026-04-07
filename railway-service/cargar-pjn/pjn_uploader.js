"use strict";

import { chromium } from "playwright";
import fs from "node:fs";

/**
 * Entorno (solo local / pruebas; en producción no definir):
 * - PJN_HEADFUL=true — ventana de Chromium visible (no usar en Railway headless).
 * - PJN_SLOW_MO_MS=100 — opcional, ralentiza acciones cuando va headful.
 * - PJN_SKIP_FINAL_SEND=true — recorre login + adjuntos hasta la pantalla previa a "Enviar"; no envía el escrito.
 *   Devuelve { ok: true, pruebaSinEnvio: true }. Vercel no marca pjn_cargado_at.
 * - PJN_HEADFUL_PAUSE_MS=8000 — si headful + skip send, espera antes de cerrar el navegador para inspeccionar.
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sube un documento al Portal PJN.
 *
 * @param {Object} params
 * @param {string} params.pdfPath     - Ruta local al PDF a subir
 * @param {string} params.expNro      - Ej: "27462/2023"
 * @param {string} params.jurisdiccion - Ej: "CIV" (extraído del expNro)
 * @returns {Promise<{ ok: boolean, pruebaSinEnvio?: boolean }>}
 */
export async function cargarEnPJN({ pdfPath, expNro, jurisdiccion }) {
  const parts = String(expNro || "")
    .trim()
    .split("/")
    .map((s) => s.trim());
  const numero = parts[0];
  const anio = parts[1];
  if (!numero || !anio) {
    throw new Error(`Formato de expNro inválido: ${expNro}`);
  }

  const usuario = process.env.PJN_USUARIO;
  const password = process.env.PJN_PASSWORD;
  if (!usuario || !password) {
    throw new Error("Credenciales PJN no configuradas");
  }

  const headful = process.env.PJN_HEADFUL === "true";
  const skipFinalSend = process.env.PJN_SKIP_FINAL_SEND === "true";
  const slowMo = Math.max(
    0,
    parseInt(String(process.env.PJN_SLOW_MO_MS || "0"), 10) || 0
  );
  const headfulPauseMs = Math.max(
    0,
    parseInt(String(process.env.PJN_HEADFUL_PAUSE_MS || "8000"), 10) || 0
  );

  const browser = await chromium.launch({
    headless: !headful,
    slowMo: headful && slowMo > 0 ? slowMo : 0,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // ── PASO 1: Login SSO ──────────────────────────────────────────
    await page.goto(
      "https://sso.pjn.gov.ar/auth/realms/pjn/protocol/openid-connect/auth" +
        "?client_id=pjn-portal" +
        "&redirect_uri=https%3A%2F%2Fportalpjn.pjn.gov.ar%2Fauth%2Fcallback" +
        "&response_type=code&scope=openid"
    );
    await page.getByRole("textbox", { name: "Usuario" }).fill(usuario);
    await page.getByRole("textbox", { name: "Contraseña" }).fill(password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.waitForURL(/inicio/, { timeout: 60000 });

    // ── PASO 2: Abrir sección de escritos (popup) ──────────────────
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page
        .locator("div:nth-child(6) > .MuiButtonBase-root > .MuiListItemIcon-root")
        .click(),
    ]);
    await popup.waitForLoadState();

    // ── PASO 3: Nuevo escrito ──────────────────────────────────────
    await popup.getByRole("menuitem", { name: "Nuevo" }).click();

    // ── PASO 4: Pantalla 1 — Datos del expediente ──────────────────
    await popup.getByRole("button", { name: "Abierto" }).first().click();
    await popup
      .getByRole("option", { name: new RegExp(jurisdiccion, "i") })
      .first()
      .click();

    await popup.getByRole("spinbutton", { name: "Número de expediente" }).fill(numero);
    await popup.getByRole("spinbutton", { name: "Año" }).fill(anio);
    await popup.getByRole("button", { name: "Siguiente" }).click();

    // ── PASO 5: Pantalla 2 — Selección de expediente ──────────────
    await popup.waitForSelector("text=Se han encontrado", { timeout: 10000 });

    const opciones = await popup.getByRole("option").all();
    let elegida = false;
    for (const opcion of opciones) {
      const texto = await opcion.textContent();
      if (texto && !texto.includes("/1")) {
        await opcion.click();
        elegida = true;
        break;
      }
    }
    if (!elegida) {
      await popup.getByRole("listbox").getByRole("option").first().click();
    }
    await popup.getByRole("button", { name: "Siguiente" }).click();

    // ── PASO 6: Pantalla 3 — Selección de destinatario ────────────
    await popup.waitForSelector('[role="option"]', { timeout: 8000 });
    await popup.getByRole("option").first().click();
    await popup.getByRole("button", { name: "Siguiente" }).click();

    // ── PASO 7: Pantalla 4 — Selección de adjuntos ────────────────
    await popup.getByRole("button", { name: "Abierto" }).click();
    await popup.getByRole("option", { name: "ESCRITO", exact: true }).click();

    await popup.getByRole("button", { name: "Seleccionar" }).click();
    await popup.locator('input[type="file"]').setInputFiles(pdfPath);

    await popup
      .getByRole("textbox", { name: /Descripción Archivo/i })
      .fill("Acredita Diligenciamiento Cedula");
    await popup.getByRole("button", { name: "Aceptar" }).click();
    await popup.getByRole("button", { name: "Siguiente" }).click();

    // ── PASO 8: Confirmación y envío (omitir en prueba local sin presentar) ──
    if (skipFinalSend) {
      console.log(
        "[pjn_uploader] PJN_SKIP_FINAL_SEND: detenido antes de Enviar (sin escrito presentado)"
      );
      if (headful && headfulPauseMs > 0) {
        await sleep(headfulPauseMs);
      }
      return { ok: true, pruebaSinEnvio: true };
    }

    await popup.getByRole("button", { name: "Enviar" }).click();

    await popup
      .waitForSelector("text=enviado", { timeout: 15000, state: "visible" })
      .catch(() => {});

    return { ok: true };
  } finally {
    await browser.close();
    try {
      fs.unlinkSync(pdfPath);
    } catch (_) {
      /* ignore */
    }
  }
}
