# Bug: `pdf-extractor-service` devuelve XHTML vacío para PDFs sin texto seleccionable

**Estado:** documentado. **No** se modifica `pdf-extractor-service/server.js` en este parche — el flujo productivo se preserva intacto. La auditoría documental en `gestor-cedulas` ya está defendida contra este caso vía `esTextoJudicialUtil` (ver `lib/auditoria-tipo-documento-pdf.ts`).

## Síntoma reproducido en producción

`POST /api/admin/auditoria-tipo-documento-pdf/run?limit=2&dry_run=true&use_ocr=true&debug_text=true`:

```json
{
  "fuente_texto": "ocr",
  "texto_chars": 330,
  "clasificacion_pdf": "INDETERMINADO",
  "confianza": 0,
  "debug_text": "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" ...><meta name=\"Producer\" content=\"PyPDF2\"/><body><doc><page width=\"594.300000\" height=\"840.510000\"></page></doc></body></html>"
}
```

5 de 5 ítems con el mismo XHTML residual.

## Causa raíz

`pdf-extractor-service/server.js`, función `extractTextWithPoppler`, encadena 4 estrategias de `pdftotext`:

| # | Comando | Output esperado |
|---|---|---|
| 1 | `pdftotext -layout -nopgbrk -enc UTF-8 -f 1 -l 1` | texto plano |
| 2 | `pdftotext -raw -nopgbrk -enc UTF-8 -f 1 -l 1` | texto plano |
| **3** | **`pdftotext -bbox -f 1 -l 1`** | **XHTML con bounding boxes** |
| 4 | `pdftotext -f 1 -l 1` | texto plano |

Para PDFs generados por **PyPDF2** (típico de exports automatizados desde scripts: no llevan capa de texto real, solo imagen rasterizada y estructura mínima):

- Estrategias 1, 2 y 4 → output vacío (< 30 chars) → se descartan.
- Estrategia 3 (`-bbox`) → devuelve XHTML con `<page width="..." height="..." />` para describir las páginas, **pero sin texto** dentro de los `<page>` (porque no hay texto seleccionable). El XHTML tiene ~300+ chars y supera el umbral del microservicio (`textLength < 100` → activar OCR).
- Resultado: el microservicio **considera que extrajo texto** y **no activa Tesseract**.

La condición del microservicio:

```js
// pdf-extractor-service/server.js, línea ~445
let extractedText = await extractTextWithPoppler(tempPdfPath);
const textLength = extractedText ? extractedText.trim().length : 0;
if (textLength < 100) {
  // ... activar Tesseract
}
```

El XHTML de la estrategia 3 tiene ~300 chars de tags vacíos → no entra al branch del OCR. Devuelve `raw_preview` con el XHTML truncado a 500 chars.

## Mitigación ya aplicada en `gestor-cedulas` (este parche)

`lib/auditoria-tipo-documento-pdf.ts`:

- `esTextoJudicialUtil(texto)` — rechaza HARD cualquier texto que matchee marcadores HTML/XML (`<!DOCTYPE html`, `<html`, `<doc`, `<page width=`, `Producer" content="PyPDF2"`) o que después de stripear tags no tenga contenido alfabético/judicial mínimo.
- `obtenerTextoParaAuditoria()` invoca este filtro tanto sobre el texto local como sobre la respuesta del OCR. Si el OCR devuelve XHTML, el resultado pasa a `fuente: "sin_texto"` con detalle:
  > "El extractor devolvió N chars sin contenido judicial útil (posible XHTML vacío de pdftotext -bbox; el microservicio no cayó a Tesseract)"

La auditoría ya no clasifica esos PDFs como `INDETERMINADO` con confianza 0 y fuente "ocr" engañosa: ahora los reporta correctamente como `sin_texto` para que el operador pueda identificarlos.

## Fix propuesto en el microservicio (NO aplicado aquí)

Cualquiera de estas opciones, en orden de impacto:

### Opción A — Eliminar la estrategia 3 `-bbox` (RECOMENDADA)

`-bbox` está pensada para extraer coordenadas, no texto. Para nuestro caso de uso (extraer texto para clasificar) nunca produce algo útil — solo introduce falsos positivos.

```diff
 // pdf-extractor-service/server.js, función extractTextWithPoppler

-  // Estrategia 3: pdftotext con bbox (bounding box, puede extraer texto de capas ocultas)
-  try {
-    const stdout = await execWithTimeout(
-      `pdftotext -bbox -f 1 -l 1 "${pdfPath}" -`,
-      8000
-    );
-    if (stdout && stdout.trim().length > 30) {
-      console.log(`✅ pdftotext bbox extrajo ${stdout.trim().length} caracteres`);
-      return stdout;
-    }
-  } catch (error) {
-    console.error("pdftotext bbox falló:", error.message);
-  }
```

### Opción B — Detectar XHTML residual y descartar

Si se quiere preservar la estrategia 3 para casos hipotéticos donde sí extraiga texto útil, agregar un filtro de salida:

```js
// Antes de devolver stdout en la estrategia 3:
const looksLikeEmptyXhtml =
  /<!DOCTYPE\s+html/i.test(stdout) &&
  stdout.replace(/<[^>]*>/g, "").trim().length < 30;
if (looksLikeEmptyXhtml) {
  console.log("⚠️ pdftotext bbox devolvió XHTML vacío, ignorando");
  // continuar a la siguiente estrategia
} else if (stdout && stdout.trim().length > 30) {
  return stdout;
}
```

### Opción C — Cambiar el umbral de activación de Tesseract

Subir el umbral de 100 a, por ejemplo, 200 caracteres **descontando tags**:

```js
const textLength = extractedText
  ? extractedText.replace(/<[^>]*>/g, "").trim().length
  : 0;
if (textLength < 100) { /* activar Tesseract */ }
```

Esto fuerza el OCR de Tesseract en los PDFs PyPDF2, que es exactamente lo que necesitamos.

### Validación post-fix

Antes de mergear, validar con un PDF generado por PyPDF2 que la auditoría devuelve `fuente_texto: "ocr"` con texto judicial real (`Carátula:`, `Juzgado:`, etc.). Ejemplo de comando local:

```bash
curl -F "file=@/path/to/pypdf2-generated.pdf" \
  http://localhost:3000/extract | jq
```

El `debug.ocr_used` debe ser `true` y `raw_preview` debe contener texto plano, no XHTML.

## Variables de entorno relacionadas

- `PDF_EXTRACTOR_URL` — URL completa del endpoint `/extract` (en Vercel).
- `OCR_TIMEOUT` (microservicio) — default 12000 ms.
- `ENDPOINT_TIMEOUT` (microservicio) — default 28000 ms.

## Referencias

- Microservicio: `pdf-extractor-service/server.js`
- Cliente OCR en gestor: `lib/auditoria-tipo-documento-pdf.ts` (`createPdfExtractorOcrClient`).
- Filtro de utilidad en gestor: `lib/auditoria-tipo-documento-pdf.ts` (`esTextoJudicialUtil`).
- Tests del filtro: `scripts/test-auditoria-tipo-documento.ts` (`testEsTextoJudicialUtil`, `testOrquestadorRechazaXhtml`).
