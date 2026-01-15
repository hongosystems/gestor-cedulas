// Cargar configuración guardada al abrir la página
document.addEventListener('DOMContentLoaded', async () => {
  const { appUrl, syncToken } = await chrome.storage.local.get(['appUrl', 'syncToken']);
  
  if (appUrl) {
    document.getElementById('appUrl').value = appUrl;
  } else {
    // Default: producción
    document.getElementById('appUrl').value = 'https://gestor-cedulas.vercel.app';
  }
  
  if (syncToken) {
    document.getElementById('syncToken').value = syncToken;
  }
});

// Guardar configuración
document.getElementById('configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const appUrl = document.getElementById('appUrl').value.trim();
  const syncToken = document.getElementById('syncToken').value.trim();
  
  const statusDiv = document.getElementById('status');
  
  if (!appUrl || !syncToken) {
    statusDiv.textContent = 'Por favor, completá todos los campos';
    statusDiv.className = 'status error show';
    return;
  }
  
  // Validar URL
  try {
    new URL(appUrl);
  } catch {
    statusDiv.textContent = 'La URL ingresada no es válida';
    statusDiv.className = 'status error show';
    return;
  }
  
  try {
    await chrome.storage.local.set({ appUrl, syncToken });
    statusDiv.textContent = '✅ Configuración guardada correctamente';
    statusDiv.className = 'status success show';
    
    // Ocultar mensaje después de 3 segundos
    setTimeout(() => {
      statusDiv.className = 'status';
    }, 3000);
  } catch (error) {
    statusDiv.textContent = '❌ Error al guardar: ' + error.message;
    statusDiv.className = 'status error show';
  }
});
