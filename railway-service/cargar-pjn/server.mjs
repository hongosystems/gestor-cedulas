/**
 * Microservicio Railway — POST /cargar-pjn (multipart pdf):
 * - Si viene "expNro": flujo directo cargarEnPJN (expNro + jurisdiccion opcional).
 * - Si no: integración Vercel (ocr_exp_nro, ocr_caratula, cedula_id).
 * Variables: PJN_USUARIO, PJN_PASSWORD, PJN_JURISDICCION,
 * opcional: RAILWAY_INTERNAL_SECRET, PJN_UPLOAD_DRY_RUN=true,
 * pruebas locales: PJN_HEADFUL, PJN_SKIP_FINAL_SEND, PJN_SLOW_MO_MS, PJN_HEADFUL_PAUSE_MS (ver pjn_uploader.js).
 */
import express from "express";
import multer from "multer";
import fs from "fs/promises";
import { cargarEnPJN } from "./pjn_uploader.js";
import { cargarPdfEnPjn } from "./lib/pjn-upload.mjs";

const upload = multer({
  dest: "/tmp",
  limits: { fileSize: 25 * 1024 * 1024 },
});

const app = express();
const port = Number(process.env.PORT || 3000);

app.get("/", (_req, res) => {
  res.type("text").send("cargar-pjn ok");
});

/** Comprobar que este proceso es el correcto: GET http://localhost:PUERTO/cargar-pjn */
app.get("/cargar-pjn", (_req, res) => {
  res.json({
    ok: true,
    service: "cargar-pjn",
    postMultipart: "POST /cargar-pjn (campo pdf)",
  });
});

app.post("/cargar-pjn", upload.single("pdf"), async (req, res) => {
  const secret = process.env.RAILWAY_INTERNAL_SECRET;
  if (secret && req.headers["x-internal-secret"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const file = req.file;
  if (!file?.path) {
    return res.status(400).json({ ok: false, error: "PDF requerido" });
  }

  const { expNro, jurisdiccion } = req.body;
  const expNroTrimmed = String(expNro ?? "").trim();

  if (expNroTrimmed) {
    try {
      const resultado = await cargarEnPJN({
        pdfPath: file.path,
        expNro: expNroTrimmed,
        jurisdiccion:
          (jurisdiccion && String(jurisdiccion).trim()) ||
          expNroTrimmed.split("/")[0] ||
          "CIV",
      });
      return res.json(resultado);
    } catch (err) {
      console.error("[cargar-pjn]", err.message);
      return res.status(500).json({ error: err.message });
    } finally {
      try {
        await fs.unlink(file.path);
      } catch {
        /* cargarEnPJN puede haber borrado el archivo */
      }
    }
  }

  const ocr_exp_nro = String(req.body?.ocr_exp_nro ?? "");
  const ocr_caratula = String(req.body?.ocr_caratula ?? "");
  const cedula_id = String(req.body?.cedula_id ?? "");

  try {
    const out = await cargarPdfEnPjn({
      pdfPath: file.path,
      ocrExpNro: ocr_exp_nro,
      ocrCaratula: ocr_caratula,
      cedulaId: cedula_id,
    });
    return res.json(out ?? { ok: true });
  } catch (e) {
    console.error("[cargar-pjn]", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  } finally {
    try {
      await fs.unlink(file.path);
    } catch {
      /* ignore */
    }
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`cargar-pjn listening on http://0.0.0.0:${port}`);
  console.log(`  GET  http://localhost:${port}/cargar-pjn  (comprobación)`);
  console.log(`  POST http://localhost:${port}/cargar-pjn (multipart pdf)`);
});
