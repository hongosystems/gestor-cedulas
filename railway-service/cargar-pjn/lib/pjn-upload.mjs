import { cargarEnPJN } from "../pjn_uploader.js";

/**
 * @param {{ pdfPath: string, ocrExpNro: string, ocrCaratula?: string, cedulaId?: string }} opts
 */
export async function cargarPdfEnPjn(opts) {
  const { pdfPath, ocrExpNro } = opts;

  if (process.env.PJN_UPLOAD_DRY_RUN === "true") {
    console.log("[pjn-upload] PJN_UPLOAD_DRY_RUN: omitiendo Playwright");
    return { ok: true, dryRun: true };
  }

  const jurisdiccion = process.env.PJN_JURISDICCION?.trim();
  if (!jurisdiccion) {
    throw new Error(
      "Definir PJN_JURISDICCION (código para el desplegable del portal, ej. CIV)"
    );
  }

  return await cargarEnPJN({
    pdfPath,
    expNro: ocrExpNro,
    jurisdiccion,
  });
}
