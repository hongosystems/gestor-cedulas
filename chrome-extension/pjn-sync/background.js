// Background script para comunicación entre nuestra app y la extensión

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sync-favoritos') {
    // Buscar la pestaña del PJN con favoritos
    chrome.tabs.query({ url: 'https://scw.pjn.gov.ar/scw/*' }, (tabs) => {
      const favoritosTab = tabs.find(tab => 
        tab.url && (
          tab.url.includes('consultaListaFavoritos') || 
          tab.url.includes('favoritos')
        )
      );

      if (favoritosTab) {
        // Inyectar script para sincronizar automáticamente
        chrome.scripting.executeScript({
          target: { tabId: favoritosTab.id },
          function: triggerAutoSync
        });
        sendResponse({ success: true, message: 'Sincronizando...' });
      } else {
        // Abrir nueva pestaña con favoritos y autoSync
        chrome.tabs.create({
          url: 'https://scw.pjn.gov.ar/scw/consultaListaFavoritos.seam?autoSync=true',
          active: true
        });
        sendResponse({ success: true, message: 'Abriendo favoritos...' });
      }
    });

    return true; // Mantener el canal abierto para respuesta asíncrona
  }

  if (request.action === 'notify-sync-complete') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'Gestor Cédulas',
      message: `✅ Sincronizados ${request.count} expedientes`
    });
  }

  if (request.action === 'notify-sync-error') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'Gestor Cédulas - Error',
      message: `❌ Error: ${request.error}`
    });
  }
});

function triggerAutoSync() {
  // Disparar evento personalizado que el content script escuchará
  window.dispatchEvent(new CustomEvent('gestor-cedulas-auto-sync'));
}

// Nota: Las notificaciones requieren permiso "notifications" en manifest.json
