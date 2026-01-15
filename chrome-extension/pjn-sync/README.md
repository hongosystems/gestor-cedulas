# Gestor Cédulas - Extensión Chrome Sync PJN

Extensión de Chrome (Manifest v3) para sincronizar expedientes favoritos del PJN con Gestor Cédulas.

## Instalación

### 1. Cargar extensión en modo desarrollador

1. Abre Chrome y ve a `chrome://extensions/`
2. Activa el **modo desarrollador** (Developer mode) en la esquina superior derecha
3. Click en **"Cargar extensión sin empaquetar"** (Load unpacked)
4. Selecciona la carpeta `chrome-extension/pjn-sync/`

### 2. Configurar la extensión

1. Click derecho en el ícono de la extensión en la barra de herramientas
2. Selecciona **"Opciones"** (Options)
3. Completa:
   - **URL del Backend**: `https://gestor-cedulas.vercel.app` (o la URL de tu app)
   - **Token de Sincronización**: Pega el token que obtuviste desde la pantalla de administración en Gestor Cédulas
4. Click en **"Guardar Configuración"**

### 3. Generar token desde Gestor Cédulas

1. Accede a Gestor Cédulas como superadmin
2. Ve a la sección de configuración de sincronización
3. Genera un nuevo token
4. Copia el token y pégalo en la configuración de la extensión

## Uso

1. **Logueate en PJN**: Ve a https://scw.pjn.gov.ar/scw/ e inicia sesión
2. **Navega a Favoritos**: Entrá a la página "Lista de Expedientes Favoritos"
3. **Sincronizar**: 
   - Deberías ver un botón flotante "🔄 Sincronizar con Gestor" en la esquina superior derecha
   - Opcional: activa/desactiva "Traer detalle" según necesites
   - Click en **"Sincronizar"**
4. **Espera**: La extensión parseará la tabla y, si está activado, leerá el detalle de cada expediente
5. **Confirmación**: Verás un mensaje de éxito con el número de registros sincronizados

## Características

- ✅ Detecta automáticamente la página de Favoritos del PJN
- ✅ Parsea la tabla de expedientes y extrae: jurisdicción, número, año, carátula, juzgado
- ✅ Opción para incluir detalles (fecha última carga + observaciones) navegando a cada expediente
- ✅ Normaliza y limpia textos automáticamente
- ✅ Envía datos al backend de Gestor Cédulas
- ✅ Muestra progreso en tiempo real
- ✅ Maneja errores con mensajes claros

## Troubleshooting

**No aparece el botón "Sincronizar"**:
- Verificá que estás en la página correcta: "Lista de Expedientes Favoritos"
- Recargá la página (F5)
- Verificá que la extensión esté habilitada en `chrome://extensions/`

**Error "Token inválido"**:
- Verificá que el token esté correctamente configurado en las opciones
- Asegurate de usar el token más reciente generado desde Gestor Cédulas

**Error "No se detectó la pantalla"**:
- Verificá que estás en la página de Favoritos del PJN
- La página debe estar completamente cargada antes de sincronizar

**Los detalles no se leen correctamente**:
- El proceso puede tardar varios segundos por expediente
- Si algún detalle falla, los datos básicos de la lista igual se sincronizan

## Notas Técnicas

- La extensión requiere permisos para leer y modificar contenido en `scw.pjn.gov.ar`
- Los datos se guardan localmente en `chrome.storage.local`
- El token NO se comparte con terceros, solo se envía a tu backend configurado
