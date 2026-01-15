import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { getCookies } from "@/lib/pjn-cookies";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ExpedienteData {
  juzgado: string | null;
  caratula: string | null;
  fechaUltimaModificacion: string | null;
  observaciones: string | null;
}

// Función para buscar expediente en Favoritos, extraer datos de la tabla y abrir detalle
async function findExpedienteInFavoritos(
  page: any, 
  jurisdiccion: string, 
  numero: string, 
  año: string
): Promise<{ found: boolean; caratula?: string; juzgado?: string }> {
  console.log(`Buscando expediente en Favoritos: ${jurisdiccion} ${numero}/${año}`);
  
  // Normalizar para comparación
  const jurisdiccionUpper = jurisdiccion.toUpperCase().trim();
  const numeroInt = parseInt(numero.trim(), 10);
  const añoNormalizado = año.trim();
  
  // Buscar información de la fila y hacer click
  const rowInfo = await page.evaluate((jur: string, num: number, anio: string) => {
    // Buscar todas las tablas
    const tables = Array.from(document.querySelectorAll("table"));
    
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll("tr"));
      if (rows.length < 2) continue;
      
      // Buscar header para identificar tabla de favoritos
      const headerRow = rows[0];
      const headerCells = Array.from(headerRow.querySelectorAll("td, th"));
      const headerTexts = headerCells.map(cell => (cell.textContent || "").trim().toUpperCase());
      
      const hasExpediente = headerTexts.some(h => h.includes("EXPEDIENTE"));
      if (!hasExpediente) continue;
      
      // Buscar índices de columnas
      const expedienteIdx = headerTexts.findIndex(h => h.includes("EXPEDIENTE"));
      const dependenciaIdx = headerTexts.findIndex(h => h.includes("DEPENDENCIA"));
      const caratulaIdx = headerTexts.findIndex(h => h.includes("CARÁTULA") || h.includes("CARATULA"));
      
      // Buscar en filas de datos
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cells = Array.from(row.querySelectorAll("td, th"));
        
        if (cells.length <= expedienteIdx) continue;
        
        // Normalizar texto: reemplazar saltos de línea, tabs y espacios múltiples por un solo espacio
        const expedienteTextRaw = cells[expedienteIdx].textContent || "";
        const expedienteText = expedienteTextRaw.replace(/[\s\n\r\t]+/g, " ").trim();
        
        // Formato esperado: "CIV 068809/2017" o "COM 008807/2025" (puede tener saltos de línea)
        // Regex más flexible: permite cualquier tipo de whitespace entre jurisdicción y número
        const match = expedienteText.match(/^([A-Z]+)\s+(\d+)\/(\d{4})$/);
        if (!match) continue;
        
        const [, expJur, expNumStr, expAnio] = match;
        const expNumInt = parseInt(expNumStr, 10);
        
        // Comparar jurisdicción, número (como int para manejar ceros a la izquierda) y año
        if (expJur.toUpperCase() === jur.toUpperCase() && 
            expNumInt === num && 
            expAnio === anio) {
          
          // Extraer datos de la tabla de favoritos
          const juzgado = dependenciaIdx >= 0 && cells[dependenciaIdx] 
            ? (cells[dependenciaIdx].textContent || "").trim().replace(/\u00A0/g, " ").replace(/\s+/g, " ") 
            : null;
          
          const caratulaRaw = caratulaIdx >= 0 && cells[caratulaIdx] 
            ? (cells[caratulaIdx].textContent || "").trim() 
            : null;
          const caratula = caratulaRaw ? caratulaRaw.replace(/^\*\s*/, "").replace(/\u00A0/g, " ").replace(/\s+/g, " ") : null;
          
          // Encontrar el link al detalle (ojito) - buscar en toda la fila
          const allLinks = Array.from(row.querySelectorAll("a"));
          
          // Buscar link con imagen ojito
          let detailLink: HTMLElement | null = null;
          for (const link of allLinks) {
            const img = link.querySelector("img");
            if (img) {
              const src = (img.getAttribute("src") || "").toLowerCase();
              const alt = (img.getAttribute("alt") || "").toLowerCase();
              if (src.includes("ojito") || src.includes("ver") || 
                  alt.includes("ver") || alt.includes("detalle")) {
                detailLink = link;
                break;
              }
            }
          }
          
          // Si no encontramos por imagen, usar el último link (típicamente el ojito está al final)
          if (!detailLink && allLinks.length > 0) {
            detailLink = allLinks[allLinks.length - 1] as HTMLElement;
          }
          
          if (detailLink) {
            // Hacer click
            (detailLink as HTMLElement).click();
            return { found: true, caratula: caratula || null, juzgado: juzgado || null };
          }
        }
      }
    }
    
    return { found: false };
  }, jurisdiccionUpper, numeroInt, añoNormalizado);
  
  if (rowInfo.found) {
    console.log("Expediente encontrado en favoritos, abriendo detalle...");
    // Esperar navegación a la página de detalle
    try {
      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 });
    } catch (e) {
      // Si no hay navegación inmediata, esperar un poco más
      console.log("Esperando carga de detalle...");
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    return rowInfo;
  }
  
  return { found: false };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jurisdiccion, numero, año } = body;

    if (!jurisdiccion || !numero || !año) {
      return NextResponse.json(
        { error: "Faltan parámetros: jurisdiccion, numero, año" },
        { status: 400 }
      );
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      
      // Obtener cookies actualizadas
      const COOKIES = getCookies();
      
      // Establecer cookies antes de navegar
      console.log(`Estableciendo ${COOKIES.length} cookies...`);
      await page.setCookie(...COOKIES);
      
      // Primero navegar a consultaListaRelacionados.seam (requerido antes de Favoritos)
      console.log("Navegando a consultaListaRelacionados...");
      await page.goto("https://scw.pjn.gov.ar/scw/consultaListaRelacionados.seam", {
        waitUntil: "networkidle0",
        timeout: 60000,
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verificar que no estemos en la página de login
      const titleAfterRelacionados = await page.title();
      console.log("Título después de relacionados:", titleAfterRelacionados);
      
      if (titleAfterRelacionados.includes("Inicie sesión") || titleAfterRelacionados.includes("Ingresar")) {
        await browser.close();
        return NextResponse.json(
          { error: "Sesión expirada o no autenticado. Por favor, inicie sesión en PJN." },
          { status: 401 }
        );
      }
      
      // Reestablecer cookies después de navegar
      await page.setCookie(...COOKIES);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Ahora navegar a la página de Favoritos
      console.log("Navegando a página de Favoritos...");
      await page.goto("https://scw.pjn.gov.ar/scw/consultaListaFavoritos.seam", {
        waitUntil: "networkidle0",
        timeout: 60000,
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verificar que la página se cargó correctamente
      const pageTitle = await page.title();
      console.log("Título de la página de Favoritos:", pageTitle);
      
      if (pageTitle.includes("Inicie sesión") || pageTitle.includes("Ingresar")) {
        await browser.close();
        return NextResponse.json(
          { error: "Sesión expirada o no autenticado. Por favor, inicie sesión en PJN." },
          { status: 401 }
        );
      }
      
      // Reestablecer cookies después de navegar a Favoritos
      await page.setCookie(...COOKIES);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Esperar a que las tablas se carguen
      try {
        await page.waitForSelector("table", { timeout: 10000 });
      } catch (e) {
        console.log("No se encontró tabla, continuando de todas formas...");
      }
      
      // Buscar expediente en Favoritos, extraer datos de la tabla y abrir detalle
      console.log("=== Buscando expediente en Favoritos ===");
      console.log(`Buscando: ${jurisdiccion} ${numero}/${año}`);
      const resultBusqueda = await findExpedienteInFavoritos(page, jurisdiccion, numero, año);
      
      if (!resultBusqueda.found) {
        await browser.close();
        return NextResponse.json(
          { error: `No se encontró el expediente ${jurisdiccion} ${numero}/${año} en la lista de favoritos` },
          { status: 404 }
        );
      }
      
      const urlAfterSearch = page.url();
      console.log("URL después de abrir detalle:", urlAfterSearch);
      
      // Extraer datos adicionales de la página de detalle (FECHA y OBSERVACIONES)
      console.log("=== Extrayendo datos del detalle ===");
      const data: ExpedienteData = {
        juzgado: resultBusqueda.juzgado || null,
        caratula: resultBusqueda.caratula || null,
        fechaUltimaModificacion: null,
        observaciones: null,
      };

      const extractedData = await page.evaluate(() => {
        const result: ExpedienteData = {
          juzgado: null,
          caratula: null,
          fechaUltimaModificacion: null,
          observaciones: null,
        };
        
        // Buscar tabla de Actuaciones - PRIMERA FILA (más reciente)
        const tables = Array.from(document.querySelectorAll("table"));
        for (const table of tables) {
          const rows = Array.from(table.querySelectorAll("tr"));
          if (rows.length < 2) continue;
          
          const headerRow = rows[0];
          const headers = Array.from(headerRow.querySelectorAll("td, th"));
          const headerTexts = headers.map(h => h.textContent?.trim().toUpperCase() || "");
          
          const hasFecha = headerTexts.some(h => h.includes("FECHA"));
          const hasDesc = headerTexts.some(h => h.includes("DESCRIPCION") || h.includes("DESCRIPCIÓN") || h.includes("DETALLE"));
          
          if (hasFecha || hasDesc) {
            const fechaIdx = headerTexts.findIndex(h => h.includes("FECHA"));
            const descIdx = headerTexts.findIndex(h => h.includes("DESCRIPCION") || h.includes("DESCRIPCIÓN") || h.includes("DETALLE"));
            
            // PRIMERA FILA DE DATOS (índice 1, después del header) - la más reciente
            if (rows.length > 1) {
              const firstDataRow = rows[1];
              const cells = Array.from(firstDataRow.querySelectorAll("td, th"));
              
              if (fechaIdx >= 0 && cells[fechaIdx] && !result.fechaUltimaModificacion) {
                const fechaText = cells[fechaIdx].textContent?.trim() || "";
                if (fechaText && /^\d{2}\/\d{2}\/\d{4}/.test(fechaText)) {
                  result.fechaUltimaModificacion = fechaText;
                }
              }
              
              if (descIdx >= 0 && cells[descIdx] && !result.observaciones) {
                const descText = cells[descIdx].textContent?.trim() || "";
                if (descText && descText.length > 0) {
                  result.observaciones = descText.replace(/\u00A0/g, " ").replace(/\s+/g, " ");
                }
              }
            }
            break;
          }
        }
        
        return result;
      });

      data.fechaUltimaModificacion = extractedData.fechaUltimaModificacion;
      data.observaciones = extractedData.observaciones;
      
      console.log("Datos extraídos:", {
        juzgado: data.juzgado ? "✓" : "✗",
        caratula: data.caratula ? "✓" : "✗",
        fechaUltimaModificacion: data.fechaUltimaModificacion ? "✓" : "✗",
        observaciones: data.observaciones ? "✓" : "✗",
      });

      await browser.close();

      return NextResponse.json(data);
    } catch (error: any) {
      await browser.close();
      throw error;
    }
  } catch (error: any) {
    console.error("Error en fetch-expediente-pjn:", error);
    return NextResponse.json(
      { error: "Error al obtener datos del expediente: " + (error.message || "Error desconocido") },
      { status: 500 }
    );
  }
}
