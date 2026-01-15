import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";

export const runtime = "nodejs";
export const maxDuration = 60; // 60 segundos máximo

// Función helper para hacer login en SSO con credenciales personalizadas
async function performLoginWithCredentials(page: any, username: string, password: string): Promise<boolean> {
  try {
    // Ir directamente a la página de login de SSO
    console.log("Intentando login en SSO...");
    await page.goto("https://sso.pjn.gov.ar/auth/realms/pjn/protocol/openid-connect/auth?client_id=pjn-portal&redirect_uri=https%3A%2F%2Fportalpjn.pjn.gov.ar%2F&response_mode=fragment&response_type=code&scope=openid", {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verificar si ya estamos logueados
    const currentUrl = page.url();
    if (currentUrl.includes("portalpjn.pjn.gov.ar") || !currentUrl.includes("sso.pjn.gov.ar")) {
      console.log("Ya estamos logueados o redirigidos");
      return true;
    }

    // Buscar campos de login de forma más robusta
    let loginSuccess = false;
    
    // Intentar múltiples métodos para encontrar y llenar los campos
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Método 1: Usar evaluate para encontrar y llenar campos
        const result = await page.evaluate((user: string, pass: string) => {
          const allInputs = Array.from(document.querySelectorAll("input"));
          
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

          const passInput = allInputs.find(input => 
            (input.getAttribute("type") || "").toLowerCase() === "password"
          );

          if (!userInput || !passInput) {
            return { success: false, reason: "No se encontraron los campos" };
          }

          (userInput as HTMLInputElement).focus();
          (userInput as HTMLInputElement).value = user;
          userInput.dispatchEvent(new Event("input", { bubbles: true }));
          userInput.dispatchEvent(new Event("change", { bubbles: true }));
          userInput.dispatchEvent(new Event("blur", { bubbles: true }));

          (passInput as HTMLInputElement).focus();
          (passInput as HTMLInputElement).value = pass;
          passInput.dispatchEvent(new Event("input", { bubbles: true }));
          passInput.dispatchEvent(new Event("change", { bubbles: true }));
          passInput.dispatchEvent(new Event("blur", { bubbles: true }));

          const submitButtons = Array.from(document.querySelectorAll("input[type='submit'], button[type='submit'], button, input[type='button']"));
          let submitButton = submitButtons.find(btn => {
            const text = (btn.textContent || btn.getAttribute("value") || "").toLowerCase();
            const type = (btn.getAttribute("type") || "").toLowerCase();
            return text.includes("ingresar") || text.includes("login") || text.includes("entrar") ||
                   text.includes("iniciar") || type === "submit";
          });

          if (!submitButton) {
            submitButton = submitButtons.find(btn => {
              const id = (btn.getAttribute("id") || "").toLowerCase();
              const name = (btn.getAttribute("name") || "").toLowerCase();
              return id.includes("login") || id.includes("submit") || name.includes("login") || name.includes("submit");
            });
          }

          if (submitButton) {
            (submitButton as HTMLElement).click();
            return { success: true };
          }

          const forms = Array.from(document.querySelectorAll("form"));
          if (forms.length > 0) {
            (forms[0] as HTMLFormElement).submit();
            return { success: true };
          }

          return { success: false, reason: "No se encontró botón de submit" };
        }, username, password);

        if (result.success) {
          loginSuccess = true;
          break;
        }

        // Método 2: Usar Puppeteer directamente
        if (!loginSuccess) {
          const allInputs = await page.$$("input");
          let usernameInput = null;
          let passwordInput = null;
          
          for (const input of allInputs) {
            const inputType = await input.evaluate((el: any) => (el.getAttribute("type") || "").toLowerCase());
            const inputName = await input.evaluate((el: any) => (el.getAttribute("name") || "").toLowerCase());
            const inputId = await input.evaluate((el: any) => (el.getAttribute("id") || "").toLowerCase());
            
            if (inputType === "password" && !passwordInput) {
              passwordInput = input;
            } else if ((inputType === "text" || inputType === "email" || !inputType) && !usernameInput) {
              if (inputName.includes("user") || inputName.includes("login") || inputId.includes("user") || inputId.includes("login")) {
                usernameInput = input;
              } else if (!usernameInput) {
                usernameInput = input;
              }
            }
          }

          if (usernameInput && passwordInput) {
            await usernameInput.click({ clickCount: 3 });
            await usernameInput.type(username, { delay: 100 });
            await new Promise(resolve => setTimeout(resolve, 500));
            
            await passwordInput.click({ clickCount: 3 });
            await passwordInput.type(password, { delay: 100 });
            await new Promise(resolve => setTimeout(resolve, 500));

            const submitButton = await page.evaluateHandle(() => {
              const buttons = Array.from(document.querySelectorAll("input, button"));
              return buttons.find((btn: any) => {
                const type = (btn.getAttribute("type") || "").toLowerCase();
                const text = ((btn.textContent || btn.getAttribute("value") || "") as string).toLowerCase();
                return type === "submit" || text.includes("ingresar") || text.includes("login") || text.includes("entrar");
              });
            });

            if (submitButton && submitButton.asElement()) {
              await submitButton.asElement()!.click();
              loginSuccess = true;
              break;
            } else {
              await passwordInput.press("Enter");
              loginSuccess = true;
              break;
            }
          }
        }

        if (!loginSuccess && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          await page.reload({ waitUntil: "networkidle0", timeout: 30000 });
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (e) {
        console.log(`Intento ${attempt + 1} de login falló:`, e);
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    if (!loginSuccess) {
      throw new Error("No se pudo completar el login después de múltiples intentos");
    }

    // Esperar redirección después del login
    try {
      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 });
    } catch (e) {
      console.log("Esperando redirección...");
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verificar que el login fue exitoso
    const finalUrl = page.url();
    const pageContent = await page.evaluate(() => document.body.textContent || "");
    
    if (finalUrl.includes("portalpjn.pjn.gov.ar")) {
      console.log("Login exitoso, redirigido a portalpjn");
      return true;
    }
    
    const isValidLogin = finalUrl.includes("scw.pjn.gov.ar") || 
                         (!pageContent.toLowerCase().includes("usuario o contraseña incorrecta") &&
                          !pageContent.toLowerCase().includes("error de autenticación"));
    
    if (isValidLogin) {
      console.log("Login exitoso, URL final:", finalUrl);
      return true;
    }

    throw new Error("El login no fue exitoso - credenciales incorrectas o página de error");
  } catch (error: any) {
    console.error("Error en performLogin:", error);
    throw new Error(`Error al hacer login: ${error.message}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pjnUsername, pjnPassword } = body;

    if (!pjnUsername || !pjnPassword) {
      return NextResponse.json(
        { success: false, error: "Faltan parámetros: pjnUsername, pjnPassword" },
        { status: 400 }
      );
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      
      console.log("=== Iniciando login ===");
      const loginSuccess = await performLoginWithCredentials(page, pjnUsername, pjnPassword);
      
      if (!loginSuccess) {
        throw new Error("No se pudo completar el login");
      }

      // Obtener cookies después del login exitoso
      const cookies = await page.cookies();
      console.log(`Cookies obtenidas: ${cookies.length}`);
      
      await browser.close();
      
      return NextResponse.json({
        success: true,
        message: "Login exitoso",
        cookiesCount: cookies.length,
      });
    } catch (error: any) {
      await browser.close();
      throw error;
    }
  } catch (error: any) {
    console.error("Error en pjn-login:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Error al realizar el login" },
      { status: 500 }
    );
  }
}
