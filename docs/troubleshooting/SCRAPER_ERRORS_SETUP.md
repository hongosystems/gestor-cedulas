# Sistema de Registro y Reintento de Errores del Scraper

Este sistema permite que el scraper registre dónde falló y procese primero esos lugares al reejecutarse.

## 📋 Pasos de Configuración

### 1. Crear la tabla en Supabase

Ejecuta la migración SQL en el SQL Editor de Supabase (proyecto pjn-scraper):

```sql
-- Crear tabla para registrar errores del scraper
CREATE TABLE IF NOT EXISTS scraper_errors (
    id BIGSERIAL PRIMARY KEY,
    page INTEGER NOT NULL,
    row INTEGER NOT NULL,
    expediente_key TEXT,
    error_type TEXT NOT NULL, -- 'timeout', 'navigation', 'read_error', 'reload_error', 'paginator_error'
    error_message TEXT,
    error_details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved BOOLEAN DEFAULT FALSE,
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMPTZ,
    UNIQUE(page, row, error_type) -- Evitar duplicados del mismo error
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_scraper_errors_resolved ON scraper_errors(resolved, created_at);
CREATE INDEX IF NOT EXISTS idx_scraper_errors_page_row ON scraper_errors(page, row);
CREATE INDEX IF NOT EXISTS idx_scraper_errors_expediente ON scraper_errors(expediente_key) WHERE expediente_key IS NOT NULL;
```

### 2. Usar el nuevo script de Python

El nuevo script `pw_mirror_favorites_to_supabase_with_retry.py` tiene las siguientes mejoras:

- **Registra errores automáticamente** cuando falla:
  - Timeouts al leer filas
  - Errores de navegación
  - Errores al recargar favoritos
  - Errores del paginador
  - Errores de procesamiento

- **Procesa errores primero** al iniciar:
  - Al ejecutar el script, primero procesa todos los errores pendientes
  - Luego continúa con el flujo normal desde donde quedó

- **Marca errores como resueltos** cuando se procesan exitosamente

## 🚀 Uso

### Ejecutar el scraper con reintento de errores:

```bash
cd c:\proyectos\pjn-scraper
python pw_mirror_favorites_to_supabase_with_retry.py
```

### Ver errores pendientes:

```bash
npm run view:scraper-errors
```

## 📊 Tipos de Errores Registrados

- `timeout`: Timeout al leer una fila de favoritos
- `navigation`: No navegó al expediente después de hacer click
- `read_error`: Error al leer los campos de una fila
- `reload_error`: Error al recargar la página de favoritos
- `paginator_error`: Error al hacer click en el número de página
- `processing`: Error al procesar el expediente

## 🔄 Flujo de Reintento

1. **Al iniciar el scraper:**
   - Lee todos los errores pendientes (`resolved = false`)
   - Los procesa primero, en orden de creación
   - Marca como resueltos los que se procesan exitosamente
   - Incrementa el contador de reintentos para los que fallan nuevamente

2. **Durante la ejecución normal:**
   - Si ocurre un error, lo registra en `scraper_errors`
   - Continúa con el siguiente expediente
   - No detiene toda la ejecución

3. **En la próxima ejecución:**
   - Los errores registrados se procesan primero
   - Esto asegura que eventualmente todos los expedientes se procesen

## 💡 Ventajas

- ✅ No pierde expedientes por errores temporales
- ✅ Reintenta automáticamente en la próxima ejecución
- ✅ Prioriza los lugares donde falló
- ✅ Mantiene un historial de errores para análisis
- ✅ No requiere intervención manual para reintentar
