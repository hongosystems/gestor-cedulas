# Script de Automatización PJN - Consulta de Expedientes

Este script automatiza la consulta de expedientes del Poder Judicial de la Nación, extrayendo información de actuaciones y descargando cédulas electrónicas cuando hay cambios.

## Requisitos Previos

1. **Node.js** (v18 o superior)
2. **Playwright browsers** instalados

## Instalación

```bash
# Instalar dependencias del proyecto
npm install

# Instalar browsers de Playwright
npx playwright install chromium
```

## Configuración

### Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto con:

```env
PJN_USER=tu_usuario_pjn
PJN_PASS=tu_contraseña_pjn
```

**⚠️ IMPORTANTE:** 
- Nunca commitees el archivo `.env` al repositorio
- No hardcodees credenciales en el código
- Usa variables de entorno para datos sensibles

## Uso

### 1. Login y Guardar Sesión

Primera vez o cuando expire la sesión:

```bash
npm run pjn:login
```

Este comando:
- Abre el navegador
- Completa el login SSO
- Guarda la sesión en `pjn-storage.json`
- La sesión se reutiliza en consultas futuras

### 2. Consultar Expediente

```bash
npm run pjn:check <jurisdiccion> <numero> <anio>
```

**Ejemplo:**
```bash
npm run pjn:check CNT 13056 2025
```

Este comando:
- Carga la sesión guardada (o pide login si expiró)
- Navega al Sistema de Consulta Web (SCW)
- Realiza la consulta por expediente
- Extrae datos generales y tabla de actuaciones
- Compara con snapshot anterior
- Descarga PDFs de nuevas cédulas electrónicas
- Guarda nuevo snapshot

## Estructura de Archivos Generados

```
proyecto/
├── pjn-storage.json          # Sesión guardada (no commitear)
├── snapshots/                # Snapshots JSON por expediente
│   └── CNT_13056_2025.json
└── downloads/                 # PDFs descargados
    └── CNT_13056_2025__19_12_2025__CEDULA_ELECTRONICA.pdf
```

## Formato de Snapshot

Cada snapshot es un archivo JSON con esta estructura:

```json
{
  "expediente_id": "CNT 13056/2025",
  "sit_actual": "EN LETRA",
  "dependencia": "JUZGADO NACIONAL DE 1RA INSTANCIA DEL TRABAJO NRO. 64",
  "caratula_masked": "OLIVERA, RODRIGO C/ POSITIVE INFORMATION...",
  "last_seen_at": "2025-01-20T10:30:00.000Z",
  "actuaciones": [
    {
      "fecha": "19/12/2025",
      "tipo": "CEDULA ELECTRONICA TRIBUNAL",
      "descripcion_detalle": "EMISIÓN DE CÉDULA - NOTIFICADO EL DÍA...",
      "oficina": "T64",
      "afs": "",
      "has_download": true,
      "has_view": true,
      "row_fingerprint": "a1b2c3d4e5f6g7h8"
    }
  ]
}
```

## Detección de Cambios

El script:
- Compara fingerprints de actuaciones (hash de fecha+tipo+descripción+oficina)
- Detecta nuevas actuaciones
- Identifica nuevas cédulas electrónicas
- Descarga automáticamente PDFs de nuevas cédulas

## Seguridad

- ✅ Credenciales en variables de entorno
- ✅ Datos sensibles enmascarados en logs
- ✅ `pjn-storage.json` en `.gitignore` (no commitea sesiones)
- ✅ Snapshots contienen solo datos necesarios (carátula enmascarada)

## Troubleshooting

### Error: "PJN_USER y PJN_PASS deben estar definidas"
- Verifica que el archivo `.env` existe y tiene las variables correctas

### Error: "No se encontró storageState"
- Ejecuta `npm run pjn:login` primero

### Error: "Sesión expirada"
- Ejecuta `npm run pjn:login` para renovar la sesión

### La tabla de actuaciones no se extrae correctamente
- El script usa selectores flexibles, pero si el DOM cambia, puede necesitar ajustes
- Revisa los logs para ver qué elementos encuentra
- Puede ser necesario ajustar los selectores en `extractExpedienteData()`

### Los PDFs no se descargan
- Verifica que la actuación tiene botón de descarga (`has_download: true`)
- Algunas actuaciones pueden no tener PDF disponible
- Revisa la carpeta `downloads/` para ver si se descargaron

## Notas Técnicas

- El script usa **Playwright** (no Puppeteer) para mejor manejo de descargas y storageState
- Modo `headless: false` por defecto para debugging (cambiar a `true` para producción)
- Timeouts configurados para páginas lentas (60s)
- Maneja tanto navegación en misma pestaña como nuevas pestañas del SCW

## Integración con API

El script puede ser llamado desde la API de Next.js. Ejemplo:

```typescript
// app/api/check-expediente/route.ts
import { checkExpediente } from '@/scripts/pjn-scraper';

export async function POST(req: Request) {
  const { jurisdiccion, numero, anio } = await req.json();
  await checkExpediente(jurisdiccion, numero, anio);
  return Response.json({ success: true });
}
```

## Próximas Mejoras

- [ ] Modo headless configurable
- [ ] Notificaciones cuando hay nuevas cédulas
- [ ] Integración con base de datos para tracking
- [ ] Soporte para múltiples expedientes en batch
- [ ] Retry automático en caso de errores temporales
