-- Migración: Copiar juzgados de Gustavo Hisi a abogado@gmail.com
-- Ejecutar este SQL en Supabase SQL Editor
-- 
-- Este script copia todos los juzgados asignados a Gustavo Hisi (gfhisi@gmail.com)
-- y los asigna también a abogado@gmail.com para poder verificar los cambios.

DO $$
DECLARE
  v_gustavo_user_id UUID;
  v_abogado_user_id UUID;
  v_juzgado TEXT;
  v_count INTEGER;
BEGIN
  -- 1. Obtener user_id de Gustavo Hisi
  SELECT id INTO v_gustavo_user_id
  FROM auth.users
  WHERE email = 'gfhisi@gmail.com';
  
  IF v_gustavo_user_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el usuario gfhisi@gmail.com';
  END IF;
  
  RAISE NOTICE '✅ Usuario Gustavo Hisi encontrado: %', v_gustavo_user_id;
  
  -- 2. Obtener user_id de abogado@gmail.com
  SELECT id INTO v_abogado_user_id
  FROM auth.users
  WHERE email = 'abogado@gmail.com';
  
  IF v_abogado_user_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el usuario abogado@gmail.com. Asegúrate de que existe.';
  END IF;
  
  RAISE NOTICE '✅ Usuario abogado@gmail.com encontrado: %', v_abogado_user_id;
  
  -- 2.1. Verificar y asignar rol de abogado si no lo tiene
  IF NOT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = v_abogado_user_id 
    AND is_abogado = TRUE
  ) THEN
    -- Insertar o actualizar rol de abogado
    INSERT INTO user_roles (user_id, is_abogado)
    VALUES (v_abogado_user_id, TRUE)
    ON CONFLICT (user_id) 
    DO UPDATE SET is_abogado = TRUE;
    
    RAISE NOTICE '✅ Rol de abogado asignado a abogado@gmail.com';
  ELSE
    RAISE NOTICE '✅ Usuario abogado@gmail.com ya tiene rol de abogado';
  END IF;
  
  -- 3. Eliminar juzgados existentes de abogado@gmail.com (para evitar duplicados)
  DELETE FROM user_juzgados
  WHERE user_id = v_abogado_user_id;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '🗑️  Juzgados existentes eliminados de abogado@gmail.com: %', v_count;
  
  -- 4. Copiar todos los juzgados de Gustavo Hisi a abogado@gmail.com
  INSERT INTO user_juzgados (user_id, juzgado)
  SELECT v_abogado_user_id, juzgado
  FROM user_juzgados
  WHERE user_id = v_gustavo_user_id;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '✅ Juzgados copiados: %', v_count;
  
  -- 5. Verificar y mostrar los juzgados copiados
  RAISE NOTICE '';
  RAISE NOTICE '📋 Juzgados asignados a abogado@gmail.com:';
  FOR v_juzgado IN 
    SELECT juzgado 
    FROM user_juzgados 
    WHERE user_id = v_abogado_user_id
    ORDER BY juzgado
  LOOP
    RAISE NOTICE '   - %', v_juzgado;
  END LOOP;
  
  -- 6. Verificar que ambos usuarios tienen los mismos juzgados
  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT juzgado FROM user_juzgados WHERE user_id = v_gustavo_user_id
    EXCEPT
    SELECT juzgado FROM user_juzgados WHERE user_id = v_abogado_user_id
  ) AS diff;
  
  IF v_count = 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE '✅ Verificación exitosa: Ambos usuarios tienen los mismos juzgados asignados.';
  ELSE
    RAISE WARNING '⚠️  Advertencia: Los usuarios tienen juzgados diferentes.';
  END IF;
  
END $$;
