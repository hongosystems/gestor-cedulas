import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { updateCookies } from "@/lib/pjn-cookies";

export const runtime = "nodejs";
export const maxDuration = 60;

// Función para hacer login en SSO
async function performLoginWithCredentials(page: any, username: string, password: string): Promise<boolean> {
  try {
    // Usar evaluate para encontrar y llenar campos de forma más robusta
    const loginResult = await page.evaluate((user: string, pass: string) => {
      const allInputs = Array.from(document.querySelectorAll("input"));
      
      // Encontrar input de usuario
      let userInput = allInputs.find(input => {
        const type = (input.getAttribute("type") || "").toLowerCase();
        const name = (input.getAttribute("name") || "").toLowerCase();
        const id = (input.getAttribute("id") || "").toLowerCase();
        return (type === "text" || type === "email" || !type) && 
               (name.includes("user") || name.includes("login") || name.includes("username") ||
                id.includes("user") || id.includes("login") || id.includes("username"));
      }) || allInputs.find(input => {
        const type = (input.getAttribute("type") || "").toLowerCase();
        return type === "text" || type === "email" || !type;
      });

      // Encontrar input de contraseña
      const passInput = allInputs.find(input => 
        (input.getAttribute("type") || "").toLowerCase() === "password"
      );

      if (!userInput || !passInput) {
        return { success: false, reason: "No se encontraron los campos" };
      }

      // Llenar campos
      (userInput as HTMLInputElement).value = user;
      userInput.dispatchEvent(new Event("input", { bubbles: true }));
      userInput.dispatchEvent(new Event("change", { bubbles: true }));

      (passInput as HTMLInputElement).value = pass;
      passInput.dispatchEvent(new Event("input", { bubbles: true }));
      passInput.dispatchEvent(new Event("change", { bubbles: true }));

      // Buscar botón de submit
      const submitButtons = Array.from(document.querySelectorAll("input[type='submit'], button[type='submit'], button, input[type='button']"));
      let submitButton = submitButtons.find(btn => {
        const text = (btn.textContent || btn.getAttribute("value") || "").toLowerCase();
        return text.includes("ingresar") || text.includes("login") || text.includes("entrar");
      });

      if (submitButton) {
        (submitButton as HTMLElement).click();
        return { success: true };
      }

      // Si no hay botón, intentar submit del form
      const forms = Array.from(document.querySelectorAll("form"));
      if (forms.length > 0) {
        (forms[0] as HTMLFormElement).submit();
        return { success: true };
      }

      return { success: false, reason: "No se encontró botón de submit" };
    }, username, password);

    if (!loginResult.success) {
      console.log("Error en login:", loginResult.reason);
      return false;
    }

    // Esperar redirección
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 });
    } catch (e) {
      // Puede que ya estemos en la página correcta
    }
    
    const finalUrl = page.url();
    const isValidLogin = finalUrl.includes("portalpjn.pjn.gov.ar") || 
                         finalUrl.includes("scw.pjn.gov.ar") ||
                         !finalUrl.includes("sso.pjn.gov.ar");
    
    return isValidLogin;
  } catch (error: any) {
    console.error("Error en login:", error);
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body;

    // Si no se proporcionan credenciales, usar las por defecto
    const pjnUsername = username || process.env.PJN_USER || "23321732909";
    const pjnPassword = password || process.env.PJN_PASS || "santaFe390!";

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      
      // Navegar a SSO
      const ssoUrl = "https://sso.pjn.gov.ar/auth/realms/pjn/protocol/openid-connect/auth?client_id=pjn-portal&redirect_uri=https%3A%2F%2Fportalpjn.pjn.gov.ar%2F&response_mode=fragment&response_type=code&scope=openid";
      await page.goto(ssoUrl, {
        waitUntil: "networkidle0",
        timeout: 60000,
      });
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Hacer login
      const loginSuccess = await performLoginWithCredentials(page, pjnUsername, pjnPassword);
      
      if (!loginSuccess) {
        throw new Error("No se pudo completar el login");
      }

      // Navegar a scw.pjn.gov.ar para obtener cookies de sesión
      await page.goto("https://scw.pjn.gov.ar/scw/home.seam", {
        waitUntil: "networkidle0",
        timeout: 60000,
      });
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Obtener todas las cookies
      const newCookies = await page.cookies();
      console.log(`Cookies obtenidas después del login: ${newCookies.length}`);

      // Actualizar las cookies en el archivo (o en una variable global)
      // Por ahora, solo verificamos que tenemos cookies de sesión
      const sessionCookies = newCookies.filter(c => 
        c.name.includes("SESSION") || 
        c.name.includes("JSESSIONID") || 
        c.name.includes("TS") || 
        c.name.includes("USID")
      );

      if (sessionCookies.length === 0) {
        throw new Error("No se obtuvieron cookies de sesión después del login");
      }

      // Actualizar las cookies en el módulo compartido
      updateCookies(newCookies);
      console.log(`Cookies actualizadas: ${newCookies.length} cookies (${sessionCookies.length} de sesión)`);

      await browser.close();

      return NextResponse.json({ 
        success: true,
        message: "Cookies actualizadas correctamente",
        cookiesCount: newCookies.length,
        sessionCookiesCount: sessionCookies.length
      });

    } catch (error: any) {
      await browser.close();
      throw error;
    }
  } catch (error: any) {
    console.error("Error en pjn-update-cookies:", error);
    return NextResponse.json(
      { 
        success: false,
        error: "Error al actualizar cookies: " + (error.message || "Error desconocido") 
      },
      { status: 500 }
    );
  }
}
