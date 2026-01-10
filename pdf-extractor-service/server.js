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
const MAX_OCR_PAGES = parseInt(process.env.MAX_OCR_PAGES || "5", 10);

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
 */
async function extractTextWithPoppler(pdfPath) {
  try {
    const { stdout } = await execAsync(`pdftotext "${pdfPath}" -`);
    return stdout || "";
  } catch (error) {
    console.error("Error ejecutando pdftotext:", error.message);
    return null;
  }
}

/**
 * Convierte PDF a imágenes usando pdftoppm
 */
async function pdfToImages(pdfPath, outputDir) {
  try {
    // Usar pdftocairo o pdftoppm para convertir a PNG
    const { stdout } = await execAsync(`pdftoppm -png -r 300 "${pdfPath}" "${path.join(outputDir, 'page')}"`);
    // Listar los archivos generados
    const files = await fs.readdir(outputDir);
    return files.filter(f => f.endsWith('.png')).sort();
  } catch (error) {
    console.error("Error convirtiendo PDF a imágenes:", error.message);
    return [];
  }
}

/**
 * Ejecuta OCR en una imagen usando Tesseract
 */
async function ocrImage(imagePath) {
  try {
    // Usar español (spa) como idioma
    const { stdout } = await execAsync(`tesseract "${imagePath}" stdout -l spa 2>/dev/null`);
    return stdout || "";
  } catch (error) {
    console.error(`Error ejecutando OCR en ${imagePath}:`, error.message);
    return "";
  }
}

/**
 * Extrae texto usando OCR en las primeras N páginas del PDF
 */
async function extractTextWithOCR(pdfPath, maxPages = MAX_OCR_PAGES) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-ocr-"));
  let allText = "";
  let pagesProcessed = 0;

  try {
    // Convertir PDF a imágenes
    const imageFiles = await pdfToImages(pdfPath, tempDir);
    
    if (imageFiles.length === 0) {
      return null;
    }

    // Procesar solo las primeras maxPages
    const pagesToProcess = imageFiles.slice(0, maxPages);
    
    for (const imageFile of pagesToProcess) {
      const imagePath = path.join(tempDir, imageFile);
      const ocrText = await ocrImage(imagePath);
      if (ocrText.trim()) {
        allText += ocrText + "\n";
        pagesProcessed++;
      }
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
      text: allText.trim(),
      pagesProcessed,
      totalPages: imageFiles.length,
    };
  } catch (error) {
    console.error("Error en proceso OCR:", error.message);
    return null;
  } finally {
    // Intentar eliminar el directorio temporal
    try {
      await fs.rmdir(tempDir, { recursive: true });
    } catch (e) {
      // Ignorar errores de limpieza
    }
  }
}

/**
 * Endpoint principal: POST /extract
 */
app.post("/extract", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Falta el archivo (campo: file)" });
  }

  // Verificar que es PDF
  if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
    return res.status(400).json({ error: "Solo se aceptan archivos PDF" });
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-extract-"));
  const tempPdfPath = path.join(tempDir, `input_${Date.now()}.pdf`);

  try {
    // Guardar archivo temporalmente
    await fs.writeFile(tempPdfPath, req.file.buffer);

    // Intentar extraer texto con pdftotext primero
    let extractedText = await extractTextWithPoppler(tempPdfPath);
    let usedOCR = false;
    let ocrInfo = null;

    // Si el texto es vacío o muy corto (< 50 caracteres), usar OCR
    if (!extractedText || extractedText.trim().length < 50) {
      console.log("Texto extraído muy corto o vacío, intentando OCR...");
      const ocrResult = await extractTextWithOCR(tempPdfPath, MAX_OCR_PAGES);
      
      if (ocrResult && ocrResult.text) {
        extractedText = ocrResult.text;
        usedOCR = true;
        ocrInfo = {
          pagesProcessed: ocrResult.pagesProcessed,
          totalPages: ocrResult.totalPages,
        };
      }
    }

    // Extraer Carátula y Juzgado
    const caratula = extractCaratula(extractedText || "");
    const juzgado = extractJuzgado(extractedText || "");

    // Obtener preview del texto (primeros 500 caracteres)
    const rawPreview = extractedText 
      ? extractedText.substring(0, 500).replace(/\n/g, " ").trim()
      : null;

    // Respuesta
    const response = {
      caratula,
      juzgado,
      raw_preview: rawPreview,
      ...(usedOCR && ocrInfo ? { debug: { ocr_used: true, ...ocrInfo } } : {}),
    };

    res.json(response);
  } catch (error) {
    console.error("Error procesando PDF:", error);
    res.status(500).json({
      error: "Error procesando PDF: " + error.message,
    });
  } finally {
    // Limpiar archivo temporal
    try {
      await fs.unlink(tempPdfPath);
      await fs.rmdir(tempDir);
    } catch (e) {
      // Ignorar errores de limpieza
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
  console.log(`MAX_OCR_PAGES: ${MAX_OCR_PAGES}`);
});
