import express from "express";
import multer from "multer";
import { exec } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
// La información SIEMPRE está en la primera página, así que solo procesamos esa
// Timeouts optimizados: Render permite hasta ~30s, pero mejor ser conservadores
const OCR_TIMEOUT = parseInt(process.env.OCR_TIMEOUT || "12000", 10); // 12 segundos timeout para OCR (muy agresivo)
const ENDPOINT_TIMEOUT = parseInt(process.env.ENDPOINT_TIMEOUT || "28000", 10); // 28 segundos timeout total (debajo del límite de Render)

// Configurar multer para manejar archivos en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB máximo
  },
});

// Middleware para parsear JSON
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "pdf-extractor" });
});

/**
 * Ejecuta un comando con timeout
 */
function execWithTimeout(command, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const child = exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });

    // Timeout
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('exit', () => {
      clearTimeout(timeout);
    });
  });
}

/**
 * Extrae la Carátula del texto
 * Patrones soportados:
 * 1. Expediente caratulado: "..."
 * 2. Expte N° / expten° seguido de número/año y carátula
 * 3. Para OFICIO: texto entre comillas con patrón C/ o S/
 */
function extractCaratula(text) {
  if (!text) return null;

  // Normalizar el texto
  let normalized = text
    .replace(/\u00A0/g, " ") // nbsp
    .replace(/\u201C/g, '"')  // Comilla curva izquierda "
    .replace(/\u201D/g, '"')  // Comilla curva derecha "
    .replace(/\u201E/g, '"')  // Comilla baja „
    .replace(/\u201F/g, '"')  // Comilla alta ‟
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  function cleanCaratula(value) {
    value = value
      .replace(/\u201C/g, '"')
      .replace(/\u201D/g, '"')
      .replace(/\u201E/g, '"')
      .replace(/\u201F/g, '"');
    value = value.replace(/^[""]+|[""]+$/g, "").trim();
    value = value.replace(/\([^)]*\)/g, "").trim();
    value = value.replace(/\s+/g, " ").trim();
    return value;
  }

  // Detectar si es OFICIO
  const isOficio = /\bOFICIO\b/i.test(normalized.substring(0, 200));

  // Patrón 1: Expediente caratulado: "..."
  let match = /Expediente\s+caratulado\s*:\s*"([^"]+)"/i.exec(normalized);
  if (match?.[1]) {
    const value = cleanCaratula(match[1]);
    if (value.length) return value.toUpperCase();
  }

  // Patrón 2: Expediente caratulado sin comillas
  match = /Expediente\s+caratulado\s*:\s*([^.\n]+?)(?:\.|$|\n)/i.exec(normalized);
  if (match?.[1]) {
    const value = cleanCaratula(match[1]);
    if (value.length) return value.toUpperCase();
  }

  // Patrón 3: expten° / Expte N° seguido de número/año y carátula
  match = /(?:expten[°º]|Expte\s+N°)\s+\d+\/\d+\s*(?:"([^"]+?)"|([A-ZÁÉÍÓÚÑ][^(]+?)(?:\(|\s+que\s+tramita|\.\s*$))/i.exec(normalized);
  if (match?.[1] || match?.[2]) {
    let value = cleanCaratula(match[1] || match[2] || "");
    if ((/[cC]\s*\/\s+/.test(value) || /[sS]\s*\/\s+/.test(value)) && 
        value.length > 10 && value.length < 500) {
      return value.toUpperCase();
    }
  }

  // Para OFICIO: buscar texto entre comillas con patrón C/ o S/
  if (isOficio) {
    const quotesPattern = /"([^"]+?)"/g;
    let quoteMatch;
    while ((quoteMatch = quotesPattern.exec(normalized)) !== null) {
      if (quoteMatch[1] && quoteMatch[1].trim().length > 15) {
        let value = cleanCaratula(quoteMatch[1]);
        const hasPattern = /[cC]\s*\/\s+/.test(value) || /[sS]\s*\/\s+/.test(value);
        const validLength = value.length > 15 && value.length < 500;
        if (hasPattern && validLength) {
          return value.toUpperCase();
        }
      }
    }
  }

  return null;
}

/**
 * Extrae el Juzgado del texto
 * Patrones:
 * 1. que tramita ante el Juzgado... N° X
 * 2. TRIBUNAL ... -
 */
function extractJuzgado(text) {
  if (!text) return null;

  const normalized = text
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Patrón 1: "que tramita ante el Juzgado... N° X"
  let match = /que\s+tramita\s+ante\s+(?:el\s+)?(Juzgado[^,]*?\bN°\s*\d+)/i.exec(normalized);
  if (match?.[1]) {
    let value = match[1].trim();
    const numeroMatch = value.match(/^(.*?\bN°\s*\d+)/i);
    if (numeroMatch) {
      value = numeroMatch[1].trim();
    }
    value = value.replace(/,\s*$/, "").replace(/\s+/g, " ").trim();
    if (/\bN°\s*\d+/i.test(value) && value.length > 10 && value.length < 200) {
      return value.toUpperCase();
    }
  }

  // Patrón 2: Versión sin "el"
  match = /que\s+tramita\s+ante\s+(Juzgado[^,]*?\bN°\s*\d+)/i.exec(normalized);
  if (match?.[1]) {
    let value = match[1].trim();
    const numeroMatch = value.match(/^(.*?\bN°\s*\d+)/i);
    if (numeroMatch) {
      value = numeroMatch[1].trim();
    }
    value = value.replace(/,\s*$/, "").replace(/\s+/g, " ").trim();
    if (/\bN°\s*\d+/i.test(value) && value.length > 10 && value.length < 200) {
      return value.toUpperCase();
    }
  }

  // Patrón 3: TRIBUNAL ... -
  match = /TRIBUNAL\s+(.+?)(?:\s*-\s*|\s+Sito\s+en\s+)/i.exec(normalized);
  if (match?.[1]) {
    let value = match[1].trim();
    const numeroMatch = value.match(/^(.*?\bN°\s*\d+)/i);
    if (numeroMatch) {
      value = numeroMatch[1].trim();
    }
    if (value.length && value.length < 200) {
      return value.toUpperCase();
    }
  }

  // Patrón 4: Juzgado Nacional... N° X
  match = /(Juzgado\s+Nacional[^.]*?\bN°\s*\d+)/i.exec(normalized);
  if (match?.[1]) {
    let value = match[1].trim();
    value = value.replace(/,\s*$/, "").replace(/\s+/g, " ").trim();
    if (/\bN°\s*\d+/i.test(value) && value.length > 10 && value.length < 200) {
      return value.toUpperCase();
    }
  }

  return null;
}

/**
 * Extrae texto de PDF usando pdftotext
 * Intenta múltiples estrategias agresivas para extraer texto embebido
 * Si Chrome puede leerlo, el texto está ahí - solo hay que extraerlo correctamente
 */
async function extractTextWithPoppler(pdfPath) {
  // Estrategia 1: pdftotext con layout y encoding forzado
  try {
    const stdout = await execWithTimeout(
      `pdftotext -layout -nopgbrk -enc UTF-8 -f 1 -l 1 "${pdfPath}" -`,
      8000  // 8 segundos por estrategia
    );
    if (stdout && stdout.trim().length > 30) {
      console.log(`✅ pdftotext layout extrajo ${stdout.trim().length} caracteres`);
      return stdout;
    }
  } catch (error) {
    console.error("pdftotext layout falló:", error.message);
  }

  // Estrategia 2: pdftotext raw (extrae orden exacto, a veces funciona mejor con texto oculto)
  try {
    const stdout = await execWithTimeout(
      `pdftotext -raw -nopgbrk -enc UTF-8 -f 1 -l 1 "${pdfPath}" -`,
      8000  // 8 segundos por estrategia
    );
    if (stdout && stdout.trim().length > 30) {
      console.log(`✅ pdftotext raw extrajo ${stdout.trim().length} caracteres`);
      return stdout;
    }
  } catch (error) {
    console.error("pdftotext raw falló:", error.message);
  }

  // Estrategia 3: pdftotext con bbox (bounding box, puede extraer texto de capas ocultas)
  try {
    const stdout = await execWithTimeout(
      `pdftotext -bbox -f 1 -l 1 "${pdfPath}" -`,
      8000  // 8 segundos por estrategia
    );
    if (stdout && stdout.trim().length > 30) {
      console.log(`✅ pdftotext bbox extrajo ${stdout.trim().length} caracteres`);
      return stdout;
    }
  } catch (error) {
    console.error("pdftotext bbox falló:", error.message);
  }

  // Estrategia 4: pdftotext estándar pero solo primera página
  try {
    const stdout = await execWithTimeout(
      `pdftotext -f 1 -l 1 "${pdfPath}" -`,
      8000  // 8 segundos por estrategia
    );
    if (stdout && stdout.trim().length > 30) {
      console.log(`✅ pdftotext estándar extrajo ${stdout.trim().length} caracteres`);
      return stdout;
    }
  } catch (error) {
    console.error("pdftotext estándar falló:", error.message);
  }

  return "";
}

/**
 * Convierte SOLO la primera página del PDF a imagen usando pdftocairo (más rápido que pdftoppm)
 * Alternativa: usar formato PBM (más simple y rápido) en lugar de PNG
 */
async function pdfFirstPageToImage(pdfPath, outputDir) {
  const imagePath = path.join(outputDir, 'page-1.pbm');
  
  try {
    // Estrategia 1: pdftocairo a PBM (formato más simple, más rápido que PNG)
    // PBM es más rápido de generar y Tesseract lo acepta
    try {
      await execWithTimeout(
        `pdftocairo -pbm -r 100 -f 1 -l 1 "${pdfPath}" "${imagePath.replace('.pbm', '')}"`,
        8000  // 8 segundos para conversión
      );
      const files = await fs.readdir(outputDir);
      const pbmFiles = files.filter(f => f.endsWith('.pbm')).sort();
      if (pbmFiles.length > 0) {
        return pbmFiles;
      }
    } catch (error) {
      console.error("pdftocairo a PBM falló, intentando PNG:", error.message);
    }

    // Estrategia 2: pdftoppm a PNG con resolución muy baja (100 DPI)
    // Resolución más baja = más rápido, pero suficiente para OCR
    await execWithTimeout(
      `pdftoppm -png -r 100 -f 1 -l 1 "${pdfPath}" "${path.join(outputDir, 'page')}"`,
      30000  // 30 segundos para diagnóstico
    );
    const files = await fs.readdir(outputDir);
    return files.filter(f => f.endsWith('.png')).sort();
  } catch (error) {
    console.error("Error convirtiendo primera página del PDF a imagen:", error.message);
    return [];
  }
}

/**
 * Ejecuta OCR en una imagen usando Tesseract con timeout muy agresivo
 * Usa configuración optimizada para velocidad máxima
 */
async function ocrImage(imagePath, timeoutMs = OCR_TIMEOUT) {
  try {
    // Estrategia: PSM 6 (bloque de texto uniforme) - más rápido que PSM 3
    // Resolución ya reducida (100 DPI), así que no necesitamos PSM auto
    // Solo un intento rápido, si falla no reintentamos
    const stdout = await execWithTimeout(
      `tesseract "${imagePath}" stdout -l spa --psm 6 --oem 1 -c tessedit_char_whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÁÉÍÓÚÑáéíóúñ.,/():\"- " 2>/dev/null`,
      timeoutMs
    );
    if (stdout && stdout.trim().length > 30) {
      return stdout;
    }
    return "";
  } catch (error) {
    if (error.message.includes('timeout')) {
      console.error(`⏱️ OCR timeout después de ${timeoutMs}ms`);
    } else {
      console.error(`❌ Error OCR:`, error.message);
    }
    return "";
  }
}

/**
 * Extrae texto usando OCR en la PRIMERA página del PDF
 * La información siempre está en la primera página (Cédulas y Oficios)
 */
async function extractTextWithOCR(pdfPath) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-ocr-"));
  let extractedText = "";

  try {
    // Convertir SOLO la primera página a imagen
    const imageFiles = await pdfFirstPageToImage(pdfPath, tempDir);
    
    if (imageFiles.length === 0) {
      console.log("No se pudo convertir la primera página a imagen");
      return null;
    }

    // Procesar SOLO la primera imagen
    const imagePath = path.join(tempDir, imageFiles[0]);
    const startTime = Date.now();
    
    try {
      const ocrText = await ocrImage(imagePath, OCR_TIMEOUT);
      if (ocrText && ocrText.trim()) {
        extractedText = ocrText.trim();
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`OCR completado en ${elapsed}s, extraídos ${extractedText.length} caracteres`);
      } else {
        console.log("OCR no extrajo texto de la primera página");
      }
    } catch (error) {
      console.error(`Error procesando primera página con OCR:`, error.message);
    }

    // Limpiar archivos temporales
    for (const file of imageFiles) {
      try {
        await fs.unlink(path.join(tempDir, file));
      } catch (e) {
        // Ignorar errores de limpieza
      }
    }

    return {
      text: extractedText,
      pagesProcessed: extractedText ? 1 : 0,
      totalPages: 1,
    };
  } catch (error) {
    console.error("Error en proceso OCR:", error.message);
    return null;
  } finally {
    // Intentar eliminar el directorio temporal
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignorar errores de limpieza
    }
  }
}

/**
 * Endpoint principal: POST /extract
 * Con timeout total para evitar que Render lo cancele
 */
app.post("/extract", upload.single("file"), async (req, res) => {
  // Timeout total del endpoint
  const endpointTimeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        error: "El procesamiento del PDF tardó demasiado. Intenta con un PDF más pequeño o con texto seleccionable.",
        caratula: null,
        juzgado: null,
      });
    }
  }, ENDPOINT_TIMEOUT);

  try {
    if (!req.file) {
      clearTimeout(endpointTimeout);
      return res.status(400).json({ error: "Falta el archivo (campo: file)" });
    }

    // Verificar que es PDF
    if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
      clearTimeout(endpointTimeout);
      return res.status(400).json({ error: "Solo se aceptan archivos PDF" });
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-extract-"));
    const tempPdfPath = path.join(tempDir, `input_${Date.now()}.pdf`);

    try {
      // Guardar archivo temporalmente
      await fs.writeFile(tempPdfPath, req.file.buffer);

      // Intentar extraer texto con pdftotext primero (múltiples estrategias)
      let extractedText = await extractTextWithPoppler(tempPdfPath);
      let usedOCR = false;
      let ocrInfo = null;

      // Si el texto es vacío o muy corto, usar OCR
      // IMPORTANTE: La información SIEMPRE está en la primera página (Cédulas y Oficios)
      const textLength = extractedText ? extractedText.trim().length : 0;
      if (textLength < 100) {
        console.log(`⚠️ Texto extraído muy corto (${textLength} caracteres), intentando OCR...`);
        const ocrResult = await extractTextWithOCR(tempPdfPath);
        
        if (ocrResult && ocrResult.text && ocrResult.text.trim().length > 30) {
          extractedText = ocrResult.text;
          usedOCR = true;
          ocrInfo = {
            pagesProcessed: ocrResult.pagesProcessed,
            totalPages: ocrResult.totalPages,
          };
        } else {
          console.log("OCR no pudo extraer texto suficiente");
        }
      }

      // Extraer Carátula y Juzgado
      const caratula = extractCaratula(extractedText || "");
      const juzgado = extractJuzgado(extractedText || "");

      // Obtener preview del texto (primeros 500 caracteres)
      const rawPreview = extractedText 
        ? extractedText.substring(0, 500).replace(/\n/g, " ").trim()
        : null;

      clearTimeout(endpointTimeout);

      // Respuesta
      const response = {
        caratula,
        juzgado,
        raw_preview: rawPreview,
        ...(usedOCR && ocrInfo ? { debug: { ocr_used: true, ...ocrInfo } } : {}),
      };

      res.json(response);
    } catch (error) {
      clearTimeout(endpointTimeout);
      console.error("Error procesando PDF:", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Error procesando PDF: " + error.message,
          caratula: null,
          juzgado: null,
        });
      }
    } finally {
      // Limpiar archivo temporal
      try {
        await fs.unlink(tempPdfPath);
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        // Ignorar errores de limpieza
      }
    }
  } catch (error) {
    clearTimeout(endpointTimeout);
    console.error("Error en endpoint /extract:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error inesperado: " + error.message,
        caratula: null,
        juzgado: null,
      });
    }
  }
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error("Error no manejado:", err);
  res.status(500).json({
    error: "Error interno del servidor: " + err.message,
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`PDF Extractor Service escuchando en puerto ${PORT}`);
  console.log(`OCR: Solo primera página (información siempre está ahí)`);
  console.log(`OCR Timeout: ${OCR_TIMEOUT}ms`);
});
