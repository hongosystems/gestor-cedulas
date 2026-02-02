#!/usr/bin/env node

/**
 * Script para verificar los conteos de expedientes por abogado
 * Compara expedientes locales + favoritos PJN asignados según user_juzgados
 * 
 * Uso: node scripts/verify-expedientes-counts.mjs
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar variables de entorno
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Faltan variables de entorno NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Función para normalizar juzgado (igual que en la app)
function normalizarJuzgado(j) {
  if (!j) return "";
  const normalized = j.trim().replace(/\s+/g, " ").toUpperCase();
  
  // Intentar extraer número de juzgado civil
  const matchCivil = normalized.match(/JUZGADO\s+(?:NACIONAL\s+EN\s+LO\s+)?CIVIL\s+(?:N[°º]?\s*)?(\d+)/i);
  if (matchCivil && matchCivil[1]) {
    return `JUZGADO CIVIL ${matchCivil[1]}`;
  }
  
  // Si no es civil, intentar extraer cualquier número después de "JUZGADO"
  const matchGeneric = normalized.match(/JUZGADO[^0-9]*?(\d+)/i);
  if (matchGeneric && matchGeneric[1]) {
    if (normalized.includes("CIVIL")) {
      return `JUZGADO CIVIL ${matchGeneric[1]}`;
    }
    return normalized;
  }
  
  return normalized;
}

// Función para comparar juzgados (igual que en la app)
function juzgadosCoinciden(j1, j2) {
  const n1 = normalizarJuzgado(j1);
  const n2 = normalizarJuzgado(j2);
  
  // Comparación exacta
  if (n1 === n2) return true;
  
  // Extraer números de ambos
  const num1 = n1.match(/(\d+)/)?.[1];
  const num2 = n2.match(/(\d+)/)?.[1];
  
  // Si ambos tienen números y son iguales, y ambos contienen "JUZGADO" y "CIVIL"
  if (num1 && num2 && num1 === num2) {
    if (n1.includes("JUZGADO") && n2.includes("JUZGADO") && 
        n1.includes("CIVIL") && n2.includes("CIVIL")) {
      return true;
    }
  }
  
  return false;
}

async function main() {
  console.log('🔍 Verificando conteos de expedientes por abogado...\n');

  try {
    // 1. Obtener todos los usuarios abogados con sus juzgados asignados
    console.log('📋 1. Obteniendo juzgados asignados por usuario...');
    const { data: userJuzgados, error: ujError } = await supabase
      .from('user_juzgados')
      .select('user_id, juzgado');
    
    if (ujError) throw ujError;

    // Obtener perfiles
    const userIds = [...new Set(userJuzgados.map(uj => uj.user_id))];
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds);
    
    if (profilesError) throw profilesError;

    const profilesMap = new Map(profiles.map(p => [p.id, p]));

    // Crear mapa de juzgados por usuario
    const userJuzgadosMap = {};
    userJuzgados.forEach(uj => {
      if (!userJuzgadosMap[uj.user_id]) {
        userJuzgadosMap[uj.user_id] = [];
      }
      userJuzgadosMap[uj.user_id].push(uj.juzgado);
    });

    console.log(`   ✅ ${Object.keys(userJuzgadosMap).length} usuarios con juzgados asignados\n`);

    // 2. Obtener expedientes locales
    console.log('📋 2. Obteniendo expedientes locales...');
    const { data: expedientesLocales, error: expError } = await supabase
      .from('expedientes')
      .select('id, owner_user_id, juzgado, fecha_ultima_modificacion, estado')
      .eq('estado', 'ABIERTO');
    
    if (expError) throw expError;

    // Contar expedientes locales por usuario
    const expedientesPorUsuario = {};
    expedientesLocales.forEach(e => {
      if (e.owner_user_id && e.owner_user_id.trim() !== '') {
        expedientesPorUsuario[e.owner_user_id] = (expedientesPorUsuario[e.owner_user_id] || 0) + 1;
      }
    });

    console.log(`   ✅ ${expedientesLocales.length} expedientes locales encontrados\n`);

    // 3. Obtener favoritos PJN (excluyendo removidos)
    console.log('📋 3. Obteniendo favoritos PJN (excluyendo removidos)...');
    
    // Intentar cargar con columnas removido y estado
    let { data: pjnFavoritos, error: pjnError } = await supabase
      .from('pjn_favoritos')
      .select('id, juzgado, removido, estado');
    
    // Si falla porque las columnas no existen, intentar sin ellas
    if (pjnError && (pjnError.message?.includes('removido') || pjnError.message?.includes('estado'))) {
      console.log('   Columnas removido/estado no encontradas, cargando sin ellas...');
      const { data: pjnFavoritos2, error: pjnError2 } = await supabase
        .from('pjn_favoritos')
        .select('id, juzgado');
      
      if (pjnError2) {
        throw pjnError2;
      }
      // Agregar propiedades removido y estado como undefined
      pjnFavoritos = (pjnFavoritos2 || []).map(f => ({ ...f, removido: undefined, estado: undefined }));
      pjnError = null;
    }
    
    if (pjnError) throw pjnError;
    
    // Filtrar favoritos removidos en memoria
    if (pjnFavoritos) {
      const totalAntes = pjnFavoritos.length;
      pjnFavoritos = pjnFavoritos.filter(f => {
        // Si tiene columna removido, filtrar los que están removidos
        if (f.removido === true) return false;
        // Si tiene columna estado, filtrar los que están REMOVIDO
        if (f.estado === 'REMOVIDO') return false;
        return true;
      });
      const removidos = totalAntes - pjnFavoritos.length;
      if (removidos > 0) {
        console.log(`   ⚠️  ${removidos} favoritos removidos filtrados`);
      }
    }

    console.log(`   ✅ ${pjnFavoritos.length} favoritos PJN encontrados\n`);

    // 4. Asignar favoritos PJN a usuarios según juzgados
    console.log('📋 4. Asignando favoritos PJN a usuarios según juzgados...');
    const favoritosPorUsuario = {};
    
    pjnFavoritos.forEach(favorito => {
      if (!favorito.juzgado) return;
      
      // Buscar todos los usuarios que tienen este juzgado asignado
      for (const [userId, juzgadosDelUsuario] of Object.entries(userJuzgadosMap)) {
        const juzgadosNormalizados = juzgadosDelUsuario.map(j => normalizarJuzgado(j));
        const matchJuzgado = juzgadosNormalizados.some(jAsignado => {
          return juzgadosCoinciden(favorito.juzgado, jAsignado);
        });
        
        if (matchJuzgado) {
          if (!favoritosPorUsuario[userId]) {
            favoritosPorUsuario[userId] = [];
          }
          favoritosPorUsuario[userId].push(favorito.id);
        }
      }
    });

    // 5. Calcular totales por usuario
    console.log('📋 5. Calculando totales por usuario...\n');
    console.log('═'.repeat(80));
    console.log('RESUMEN DE EXPEDIENTES POR ABOGADO');
    console.log('═'.repeat(80));
    console.log('');

    const resultados = [];
    const todosLosUserIds = new Set([
      ...Object.keys(expedientesPorUsuario),
      ...Object.keys(favoritosPorUsuario)
    ]);

    for (const userId of todosLosUserIds) {
      const profile = profilesMap.get(userId);
      const nombre = profile?.full_name || profile?.email || `Usuario ${userId.substring(0, 8)}...`;
      const expedientesLoc = expedientesPorUsuario[userId] || 0;
      const favoritosPJN = favoritosPorUsuario[userId]?.length || 0;
      const total = expedientesLoc + favoritosPJN;

      resultados.push({
        nombre,
        expedientesLoc,
        favoritosPJN,
        total
      });
    }

    // Ordenar por nombre
    resultados.sort((a, b) => a.nombre.localeCompare(b.nombre));

    // Mostrar resultados
    for (const r of resultados) {
      console.log(`📊 ${r.nombre}`);
      console.log(`   Expedientes locales: ${r.expedientesLoc}`);
      console.log(`   Favoritos PJN:       ${r.favoritosPJN}`);
      console.log(`   TOTAL ESPERADO:      ${r.total}`);
      console.log('');
    }

    // 6. Estadísticas generales
    console.log('═'.repeat(80));
    console.log('ESTADÍSTICAS GENERALES');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`Total expedientes locales: ${expedientesLocales.length}`);
    console.log(`Total favoritos PJN:       ${pjnFavoritos.length}`);
    console.log(`Total usuarios:            ${resultados.length}`);
    console.log(`Suma total por usuarios:   ${resultados.reduce((sum, r) => sum + r.total, 0)}`);
    console.log('');

    // 7. Verificar favoritos PJN sin asignar
    const favoritosAsignados = new Set();
    Object.values(favoritosPorUsuario).forEach(ids => {
      ids.forEach(id => favoritosAsignados.add(id));
    });
    const favoritosSinAsignar = pjnFavoritos.filter(f => !favoritosAsignados.has(f.id));
    
    if (favoritosSinAsignar.length > 0) {
      console.log('⚠️  Favoritos PJN sin asignar a ningún usuario:');
      console.log(`   Total: ${favoritosSinAsignar.length}`);
      const juzgadosSinAsignar = [...new Set(favoritosSinAsignar.map(f => f.juzgado).filter(Boolean))];
      console.log(`   Juzgados únicos: ${juzgadosSinAsignar.length}`);
      if (juzgadosSinAsignar.length <= 10) {
        console.log(`   Juzgados: ${juzgadosSinAsignar.join(', ')}`);
      }
      console.log('');
    }

    // 8. Verificar expedientes locales sin owner
    const expedientesSinOwner = expedientesLocales.filter(e => !e.owner_user_id || e.owner_user_id.trim() === '');
    if (expedientesSinOwner.length > 0) {
      console.log('⚠️  Expedientes locales sin owner_user_id:');
      console.log(`   Total: ${expedientesSinOwner.length}`);
      console.log('');
    }

    console.log('✅ Verificación completada');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
