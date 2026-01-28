-- Migración: Limpiar tablas cedulas y expedientes para entrega al cliente
-- Ejecutar este SQL en Supabase SQL Editor
-- 
-- IMPORTANTE: Esta migración vacía completamente las tablas cedulas y expedientes
-- para que el cliente realice la primera carga de datos.
-- 
-- NO afecta:
-- - Usuarios (profiles, auth.users)
-- - Roles (user_roles)
-- - Juzgados asignados (user_juzgados)
-- - Configuraciones
-- - Otras tablas del sistema

-- ============================================
-- 1. VACIAR TABLA CEDULAS (incluye CEDULAS y OFICIOS)
-- ============================================
-- La tabla cedulas contiene tanto CEDULAS como OFICIOS
-- diferenciados por el campo tipo_documento
TRUNCATE TABLE cedulas CASCADE;

-- ============================================
-- 2. VACIAR TABLA EXPEDIENTES
-- ============================================
TRUNCATE TABLE expedientes CASCADE;

-- ============================================
-- 3. VERIFICACIÓN
-- ============================================
-- Verificar que las tablas están vacías
DO $$
DECLARE
  v_cedulas_count INTEGER;
  v_expedientes_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_cedulas_count FROM cedulas;
  SELECT COUNT(*) INTO v_expedientes_count FROM expedientes;
  
  IF v_cedulas_count = 0 AND v_expedientes_count = 0 THEN
    RAISE NOTICE '✅ Tablas limpiadas correctamente:';
    RAISE NOTICE '   - cedulas: % registros', v_cedulas_count;
    RAISE NOTICE '   - expedientes: % registros', v_expedientes_count;
  ELSE
    RAISE WARNING '⚠️ Advertencia: Las tablas no están completamente vacías';
    RAISE WARNING '   - cedulas: % registros', v_cedulas_count;
    RAISE WARNING '   - expedientes: % registros', v_expedientes_count;
  END IF;
END $$;

-- ============================================
-- NOTA IMPORTANTE SOBRE ARCHIVOS EN STORAGE
-- ============================================
-- Los archivos PDF/DOCX almacenados en Supabase Storage (bucket 'cedulas')
-- NO se eliminan automáticamente con esta migración.
-- 
-- Si necesitas limpiar también los archivos del storage, puedes:
-- 1. Ir a Supabase Dashboard → Storage → bucket 'cedulas'
-- 2. Eliminar manualmente los archivos, O
-- 3. Ejecutar un script adicional que use la API de Supabase Storage
--
-- Los archivos huérfanos no afectarán el funcionamiento del sistema,
-- pero ocuparán espacio en el storage.
