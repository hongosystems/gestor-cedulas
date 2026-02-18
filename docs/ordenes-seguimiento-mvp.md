# Órdenes Médicas y Seguimiento - MVP

## 📋 Resumen

Este documento describe la implementación del circuito de órdenes médicas y seguimiento para la vista `/prueba-pericia`. La funcionalidad está completamente detrás de un feature flag para no afectar la vista actual de detección.

## 🚀 Activación del Feature Flag

### Variable de Entorno

Agregar en `.env.local` (o variables de entorno de Vercel):

```bash
NEXT_PUBLIC_FEATURE_ORDENES_SEGUIMIENTO=true
```

**Por defecto:** `false` (la funcionalidad está desactivada)

### Comportamiento

- **Con flag = `false`**: La vista `/prueba-pericia` se ve **EXACTAMENTE igual** a como está hoy. No hay cambios visuales ni funcionales.
- **Con flag = `true`**: Se muestran tabs "Detección" y "Órdenes/Seguimiento", y se habilita toda la funcionalidad nueva.

## 📦 Migraciones SQL

### Ejecutar Migración

1. Ir a Supabase Dashboard → SQL Editor
2. Ejecutar el archivo: `migrations/create_ordenes_medicas_tables.sql`
3. Verificar que las tablas se crearon correctamente:
   - `ordenes_medicas`
   - `gestiones_estudio`
   - `comunicaciones`

### Verificación

```sql
-- Verificar que las tablas existen
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('ordenes_medicas', 'gestiones_estudio', 'comunicaciones');

-- Verificar políticas RLS
SELECT tablename, policyname 
FROM pg_policies 
WHERE tablename IN ('ordenes_medicas', 'gestiones_estudio', 'comunicaciones');
```

### Características de la Migración

- ✅ **Aditiva**: Solo crea tablas nuevas, no modifica existentes
- ✅ **Idempotente**: Puede ejecutarse múltiples veces sin problemas
- ✅ **Usa IF NOT EXISTS**: Las tablas solo se crean si no existen
- ✅ **RLS habilitado**: Row Level Security configurado para todas las tablas

## 🗄️ Estructura de Base de Datos

### Tabla: `ordenes_medicas`

Almacena las órdenes médicas subidas vinculadas a expedientes/case_ref.

**Campos principales:**
- `id` (UUID, PK)
- `case_ref` (TEXT) - Referencia del caso/expediente
- `expediente_id` (UUID, FK → expedientes, nullable)
- `storage_path` (TEXT) - Path en Supabase Storage
- `filename` (TEXT) - Nombre original del archivo
- `mime` (TEXT) - MIME type
- `size` (INTEGER) - Tamaño en bytes
- `emitida_por_user_id` (UUID, FK → auth.users)
- `estado` (TEXT) - NUEVA, EN_PROCESO, COMPLETADA, CANCELADA
- `created_at`, `updated_at` (TIMESTAMPTZ)

### Tabla: `gestiones_estudio`

Almacena el seguimiento de cada orden médica (workflow de contactos y turnos).

**Campos principales:**
- `id` (UUID, PK)
- `orden_id` (UUID, FK → ordenes_medicas)
- `estado` (TEXT) - Estados del workflow
- `centro_medico` (TEXT, nullable)
- `turno_fecha_hora` (TIMESTAMPTZ, nullable)
- `fecha_estudio_realizado` (TIMESTAMPTZ, nullable)
- `responsable_user_id` (UUID, FK → auth.users, nullable)
- `created_at`, `updated_at` (TIMESTAMPTZ)

**Estados posibles:**
- `PENDIENTE_CONTACTO_CLIENTE`
- `CONTACTO_CLIENTE_FALLIDO`
- `CONTACTO_CLIENTE_OK`
- `TURNO_CONFIRMADO`
- `SEGUIMIENTO_PRE_TURNO`
- `ESTUDIO_REALIZADO`
- `CANCELADA`

### Tabla: `comunicaciones`

Registra todas las comunicaciones (trazabilidad completa).

**Campos principales:**
- `id` (UUID, PK)
- `entidad_tipo` (TEXT) - 'ORDEN' o 'GESTION'
- `entidad_id` (UUID) - FK a ordenes_medicas.id o gestiones_estudio.id
- `canal` (TEXT) - TELEFONO, EMAIL, WHATSAPP, PRESENCIAL, OTRO
- `resultado` (TEXT) - SATISFACTORIO, INSATISFACTORIO, SIN_RESPUESTA, RECHAZO
- `motivo_falla` (TEXT, nullable)
- `detalle` (TEXT)
- `realizado_por_user_id` (UUID, FK → auth.users)
- `created_at` (TIMESTAMPTZ)

## 🔄 Workflow

### A) Crear Orden Médica

1. **Fran** (o usuario autorizado) sube una orden médica desde la vista "Detección"
2. Se crea registro en `ordenes_medicas` con estado `NUEVA`
3. Se crea automáticamente una `gestion_estudio` con estado `PENDIENTE_CONTACTO_CLIENTE`
4. Se asigna a **Andrea** (si existe) o al usuario actual

### B) Contacto con Cliente

1. **Andrea** registra contacto con cliente
2. Se crea registro en `comunicaciones`
3. Si resultado es `INSATISFACTORIO` → estado `CONTACTO_CLIENTE_FALLIDO` (permite reintentos)
4. Si resultado es `SATISFACTORIO` → estado `CONTACTO_CLIENTE_OK`

### C) Contacto con Centro Médico

1. **Andrea** contacta centro médico y fija turno
2. Se registra comunicación
3. Se guarda `turno_fecha_hora` y `centro_medico`
4. Estado → `TURNO_CONFIRMADO`

### D) Seguimiento

1. Cada contacto queda registrado en `comunicaciones`
2. Estado `SEGUIMIENTO_PRE_TURNO` hasta marcar estudio realizado

### E) Estudio Realizado

1. Al marcar `ESTUDIO_REALIZADO`:
   - Se setea `fecha_estudio_realizado`
   - Estado → `ESTUDIO_REALIZADO`
   - Se genera notificación interna a **Francisco** (si existe) o al emisor de la orden

## 🔌 API Endpoints

### POST `/api/ordenes-medicas/upload`

Sube una orden médica.

**Body (FormData):**
- `file` (File) - Archivo PDF/DOC/DOCX
- `case_ref` (string) - Referencia del caso
- `expediente_id` (string, opcional) - ID del expediente si existe

**Response:**
```json
{
  "ok": true,
  "data": { ...orden_medica },
  "gestion_creada": true
}
```

### GET `/api/ordenes-medicas/download`

Descarga una orden médica.

**Query params:**
- `orden_id` (string) - ID de la orden

**Response:** Archivo binario

### POST `/api/ordenes-medicas/comunicacion`

Registra una comunicación.

**Body:**
```json
{
  "entidad_tipo": "ORDEN" | "GESTION",
  "entidad_id": "uuid",
  "canal": "TELEFONO" | "EMAIL" | "WHATSAPP" | "PRESENCIAL" | "OTRO",
  "resultado": "SATISFACTORIO" | "INSATISFACTORIO" | "SIN_RESPUESTA" | "RECHAZO",
  "motivo_falla": "string (opcional)",
  "detalle": "string",
  "actualizar_estado": boolean (opcional),
  "nuevo_estado": "string (opcional)"
}
```

### POST `/api/ordenes-medicas/update-estado`

Actualiza el estado de una gestión.

**Body:**
```json
{
  "gestion_id": "uuid",
  "estado": "PENDIENTE_CONTACTO_CLIENTE" | ...,
  "centro_medico": "string (opcional)",
  "turno_fecha_hora": "ISO string (opcional)",
  "fecha_estudio_realizado": "ISO string (opcional)",
  "generar_notificacion": boolean (opcional)
}
```

### GET `/api/ordenes-medicas/list`

Lista todas las órdenes con sus gestiones y comunicaciones.

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "case_ref": "string",
      "filename": "string",
      "gestion": { ... },
      "comunicaciones": [ ... ],
      "semaforo": "VERDE" | "AMARILLO" | "ROJO",
      "dias_sin_contacto": number,
      "turno_vencido": boolean
    }
  ]
}
```

## 🎨 UI - Vista `/prueba-pericia`

### Tab "Detección" (default)

- **Mantiene toda la funcionalidad actual intacta**
- Agrega columna "Acciones" (solo con flag activo)
- Botón "Crear Orden Médica" por fila que abre selector de archivo

### Tab "Órdenes/Seguimiento" (solo con flag activo)

**Tabla de órdenes/gestiones:**
- Semáforo SLA (días sin contacto / turno vencido)
- Case Ref
- Archivo
- Estado Gestión
- Centro Médico
- Turno
- Responsable
- Días sin contacto
- Botón "Abrir" → abre Drawer

**Drawer (al hacer clic en "Abrir"):**
- Información de la orden
- Botón para descargar archivo
- Timeline de comunicaciones
- Acciones disponibles:
  - Registrar contacto cliente
  - Registrar contacto centro
  - Asignar turno
  - Marcar estudio realizado
  - No-show/reprogramar

### Semáforo SLA

- **VERDE**: < 5 días sin contacto
- **AMARILLO**: 5-9 días sin contacto
- **ROJO**: ≥ 10 días sin contacto o turno vencido

## ✅ Checklist de Validación

### Antes de Activar el Flag

- [ ] Migración SQL ejecutada exitosamente
- [ ] Tablas creadas: `ordenes_medicas`, `gestiones_estudio`, `comunicaciones`
- [ ] Políticas RLS verificadas
- [ ] Bucket `ordenes-medicas` existe en Supabase Storage
- [ ] Variable de entorno `NEXT_PUBLIC_FEATURE_ORDENES_SEGUIMIENTO=false` (default)

### Validación con Flag = false

- [ ] Vista `/prueba-pericia` se ve **EXACTAMENTE igual** a como está hoy
- [ ] No hay tabs visibles
- [ ] No hay columna "Acciones" en la tabla
- [ ] No hay errores en consola
- [ ] Funcionalidad de detección funciona igual que antes

### Validación con Flag = true

- [ ] Se muestran tabs "Detección" y "Órdenes/Seguimiento"
- [ ] Tab "Detección" muestra la vista actual + columna "Acciones"
- [ ] Botón "Crear Orden Médica" funciona
- [ ] Tab "Órdenes/Seguimiento" muestra tabla de órdenes
- [ ] Drawer se abre al hacer clic en "Abrir"
- [ ] Descarga de archivos funciona
- [ ] Timeline de comunicaciones se muestra correctamente
- [ ] Semáforo SLA se calcula correctamente

### Validación de Workflow

- [ ] Crear orden médica → se crea orden + gestión
- [ ] Registrar comunicación → se guarda en BD
- [ ] Actualizar estado → se refleja en UI
- [ ] Marcar estudio realizado → genera notificación
- [ ] Notificaciones llegan correctamente

## 🔒 Seguridad

- ✅ Autenticación requerida en todos los endpoints
- ✅ Verificación de permisos (usuario propietario, admin, superadmin)
- ✅ RLS habilitado en todas las tablas
- ✅ Validación de tipos de archivo en upload
- ✅ Verificación de acceso antes de descargar archivos

## 📝 Notas Importantes

1. **No se modifica la tabla `pjn_favoritos`**: Las órdenes/comunicaciones son entidades nuevas separadas
2. **Reutiliza sistema de notificaciones existente**: Usa `/api/notifications/create-mention` o inserta directamente en tabla `notifications`
3. **Storage**: Usa bucket `ordenes-medicas` (ya creado)
4. **Asignación automática**: Busca usuario "Andrea" por nombre/email, si no existe usa usuario actual
5. **Notificaciones**: Busca usuario "Francisco" para notificar cuando se marca estudio realizado

## 🐛 Troubleshooting

### Error: "Tabla no existe"
- Verificar que la migración SQL se ejecutó correctamente
- Revisar logs de Supabase

### Error: "Bucket no existe"
- Verificar que el bucket `ordenes-medicas` existe en Supabase Storage
- Verificar permisos del bucket

### Error: "No autorizado"
- Verificar políticas RLS
- Verificar que el usuario tiene permisos adecuados

### Vista no cambia con flag = true
- Verificar variable de entorno en `.env.local`
- Reiniciar servidor de desarrollo
- Verificar que la variable se está leyendo correctamente (console.log)

## 📚 Referencias

- Migración SQL: `migrations/create_ordenes_medicas_tables.sql`
- API Routes: `app/api/ordenes-medicas/*`
- Vista: `app/prueba-pericia/page.tsx`
- Sistema de notificaciones: `app/api/notifications/create-mention/route.ts`
