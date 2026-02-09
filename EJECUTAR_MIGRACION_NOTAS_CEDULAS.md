# Ejecutar Migración: Columna NOTAS en Cédulas

## ⚠️ IMPORTANTE: Esta migración debe ejecutarse en Supabase

La columna "NOTAS" no aparecerá en la aplicación hasta que ejecutes esta migración SQL en Supabase.

## 📋 Pasos para Ejecutar la Migración

### 1. Abrir Supabase SQL Editor

1. Ve a tu proyecto en [Supabase Dashboard](https://app.supabase.com)
2. Navega a **SQL Editor** en el menú lateral
3. Haz clic en **New Query**

### 2. Ejecutar la Migración

Copia y pega el siguiente SQL en el editor:

```sql
-- Migración: Agregar columna notas a la tabla cedulas
-- Este campo permite a los usuarios agregar notas personales sobre cédulas/oficios
-- para mencionar a otros colaboradores o dejarse notas a sí mismos

-- 1. Agregar columna notas (puede ser NULL para cédulas existentes)
ALTER TABLE cedulas 
ADD COLUMN IF NOT EXISTS notas TEXT DEFAULT NULL;

-- 2. Crear índice para búsquedas rápidas por notas (opcional pero recomendado)
CREATE INDEX IF NOT EXISTS idx_cedulas_notas ON cedulas(notas) WHERE notas IS NOT NULL;

-- 3. Comentario en la columna
COMMENT ON COLUMN cedulas.notas IS 'Notas editables con soporte para menciones (@username) que generan notificaciones';

-- 4. Políticas RLS para UPDATE de notas
-- Los usuarios pueden actualizar sus propias cédulas
-- Admin Cédulas y Admin Expedientes pueden actualizar todas las cédulas

-- Eliminar políticas de UPDATE si existen (para hacer la migración idempotente)
DROP POLICY IF EXISTS "Users can update their own cedulas" ON cedulas;
DROP POLICY IF EXISTS "Admin Cédulas can update all cedulas" ON cedulas;
DROP POLICY IF EXISTS "Admin Expedientes can update all cedulas" ON cedulas;

-- Política: Usuarios pueden actualizar sus propias cédulas
CREATE POLICY "Users can update their own cedulas"
  ON cedulas FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Política: Admin Cédulas puede actualizar todas las cédulas
CREATE POLICY "Admin Cédulas can update all cedulas"
  ON cedulas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_cedulas = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_cedulas = TRUE
    )
  );

-- Política: Admin Expedientes puede actualizar todas las cédulas
CREATE POLICY "Admin Expedientes can update all cedulas"
  ON cedulas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_expedientes = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.is_admin_expedientes = TRUE
    )
  );
```

### 3. Ejecutar el SQL

1. Haz clic en **Run** o presiona `Ctrl+Enter` (Windows/Linux) o `Cmd+Enter` (Mac)
2. Deberías ver un mensaje de éxito: "Success. No rows returned"

### 4. Verificar la Migración

Puedes verificar que la columna se creó correctamente ejecutando:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'cedulas' 
AND column_name = 'notas';
```

Deberías ver una fila con:
- `column_name`: `notas`
- `data_type`: `text`
- `is_nullable`: `YES`

## ✅ Después de Ejecutar la Migración

1. **Recarga la aplicación** en el navegador
2. **Verifica que la columna "Notas" aparezca** en la tabla de "Mis Cédulas/Oficios"
3. **Prueba agregar una nota** a una cédula
4. **Prueba mencionar a un usuario** usando `@username`

## 🔍 Verificar con Script

También puedes usar el script de verificación:

```bash
node scripts/check-cedulas-notas-column.mjs
```

Este script verificará:
- ✅ Si la columna `notas` existe
- ✅ Si los permisos RLS están configurados correctamente

## 📝 Notas Importantes

- **La migración es idempotente**: Puedes ejecutarla múltiples veces sin problemas
- **No afecta datos existentes**: Las cédulas existentes tendrán `notas = NULL`
- **Permisos**: 
  - Usuarios normales pueden actualizar solo sus propias cédulas
  - Admin Cédulas y Admin Expedientes pueden actualizar todas las cédulas

## 🐛 Si Hay Problemas

Si encuentras errores al ejecutar la migración:

1. **Verifica que tienes permisos de administrador** en Supabase
2. **Revisa la consola de errores** en Supabase SQL Editor
3. **Verifica que la tabla `cedulas` existe** y tiene la columna `owner_user_id`
4. **Verifica que la tabla `user_roles` existe** con las columnas `is_admin_cedulas` e `is_admin_expedientes`
