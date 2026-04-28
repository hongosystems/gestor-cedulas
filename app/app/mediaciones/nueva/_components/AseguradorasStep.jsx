'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const emptyItem = () => ({
  requeridoId: '',
  matricula: '',
  denominacion: '',
  cuit: '',
  domicilio: { direccion: '', localidad: '', provincia: '' },
  poliza: '',
  numeroSiniestro: '',
  domicilioManual: false,
});

export default function AseguradorasStep({ value = [], onChange, requeridoId }) {
  const [aseguradoras, setAseguradoras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState(value);

  useEffect(() => {
    fetch('/api/aseguradoras')
      .then((r) => {
        if (!r.ok) throw new Error('Error cargando aseguradoras');
        return r.json();
      })
      .then((data) => {
        setAseguradoras(data.aseguradoras || []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    onChange?.(items);
  }, [items, onChange]);

  function updateItem(idx, patch) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function updateDomicilio(idx, campo, valor) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? { ...it, domicilio: { ...it.domicilio, [campo]: valor }, domicilioManual: true }
          : it
      )
    );
  }

  function selectAseguradora(idx, aseg) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        return {
          ...it,
          matricula: aseg.matricula,
          denominacion: aseg.denominacion,
          cuit: aseg.cuit ?? '',
          domicilio: aseg.domicilio
            ? {
                direccion: aseg.domicilio.direccion ?? '',
                localidad: aseg.domicilio.localidad ?? '',
                provincia: aseg.domicilio.provincia ?? '',
              }
            : { direccion: '', localidad: '', provincia: '' },
          domicilioManual: false,
        };
      })
    );
  }

  function addAseguradora(requeridoId) {
    setItems((prev) => [...prev, { ...emptyItem(), requeridoId }]);
  }

  function removeAseguradora(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ marginTop: 12 }}>
      {error && <div className="error">No se pudo cargar el listado oficial: {error}. Podes cargar los datos manualmente.</div>}

      {items
        .map((it, idx) => ({ it, idx }))
        .filter((x) => x.it.requeridoId === requeridoId)
        .map(({ it, idx }) => (
          <AseguradoraCard
            key={idx}
            idx={idx}
            item={it}
            aseguradoras={aseguradoras}
            loading={loading}
            onSelect={(aseg) => selectAseguradora(idx, aseg)}
            onUpdate={(patch) => updateItem(idx, patch)}
            onUpdateDomicilio={(campo, val) => updateDomicilio(idx, campo, val)}
            onRemove={() => removeAseguradora(idx)}
          />
        ))}
      <button type="button" onClick={() => addAseguradora(requeridoId)} className="btn" style={{ width: '100%' }}>
        + Agregar Aseguradora
      </button>
    </div>
  );
}

function AseguradoraCard({
  idx,
  item,
  aseguradoras,
  loading,
  onSelect,
  onUpdate,
  onUpdateDomicilio,
  onRemove,
}) {
  const yaSeleccionada = !!item.denominacion;
  const noTieneDomicilio = yaSeleccionada && !item.domicilio.direccion && !item.domicilioManual;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="label">Aseguradora {idx + 1}{item.denominacion ? `: ${item.denominacion}` : ''}</span>
        <button type="button" className="btn danger" onClick={onRemove} style={{ padding: '4px 10px', fontSize: 12 }}>
          Quitar
        </button>
      </div>

      <AseguradoraCombobox
        value={item.denominacion}
        loading={loading}
        aseguradoras={aseguradoras}
        onSelect={onSelect}
      />

      {yaSeleccionada && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="CUIT">
              <input
                type="text"
                value={item.cuit || '-'}
                readOnly
                className="input"
              />
            </Field>
            <Field label="Matrícula SSN">
              <input
                type="text"
                value={item.matricula}
                readOnly
                className="input"
              />
            </Field>
          </div>

          {noTieneDomicilio && (
            <div style={{ fontSize: 12, color: '#fbbf24', border: '1px solid rgba(251,191,36,.35)', borderRadius: 8, padding: '8px 10px', background: 'rgba(251,191,36,.08)' }}>
              No tenemos el domicilio registrado para esta aseguradora. Completalo manualmente abajo.
            </div>
          )}

          <Field label="Domicilio">
            <input
              type="text"
              value={item.domicilio.direccion}
              onChange={(e) => onUpdateDomicilio('direccion', e.target.value)}
              placeholder="Calle y número"
              className="input"
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Localidad">
              <input
                type="text"
                value={item.domicilio.localidad}
                onChange={(e) => onUpdateDomicilio('localidad', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Provincia">
              <input
                type="text"
                value={item.domicilio.provincia}
                onChange={(e) => onUpdateDomicilio('provincia', e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="N° de póliza">
              <input
                type="text"
                value={item.poliza}
                onChange={(e) => onUpdate({ poliza: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="N° de siniestro">
              <input
                type="text"
                value={item.numeroSiniestro}
                onChange={(e) => onUpdate({ numeroSiniestro: e.target.value })}
                className="input"
              />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function AseguradoraCombobox({ value, loading, aseguradoras, onSelect }) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return aseguradoras.slice(0, 50);
    const q = normalizar(query);
    return aseguradoras.filter((a) => normalizar(a.denominacion).includes(q)).slice(0, 50);
  }, [query, aseguradoras]);

  function handleSelect(aseg) {
    onSelect(aseg);
    setQuery(aseg.denominacion);
    setOpen(false);
    setHighlight(0);
  }

  function handleKey(e) {
    if (!open && e.key !== 'Escape') setOpen(true);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && filtered[highlight]) {
      e.preventDefault();
      handleSelect(filtered[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <Field label="Compañía">
      <div ref={containerRef} style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder={loading ? 'Cargando...' : 'Buscar aseguradora...'}
          disabled={loading}
          className="input"
          autoComplete="off"
        />

        {open && !loading && filtered.length > 0 && (
          <ul style={{ position: 'absolute', zIndex: 60, left: 0, right: 0, top: '100%', marginTop: 4, maxHeight: 288, overflowY: 'auto', background: '#0b2238', border: '1px solid #2c4b68', borderRadius: 8, boxShadow: '0 10px 24px rgba(0,0,0,.45)' }}>
            {filtered.map((a, i) => (
              <li
                key={a.matricula + a.cuit}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => handleSelect(a)}
                style={{ padding: '8px 10px', cursor: 'pointer', background: i === highlight ? 'rgba(255,255,255,.12)' : 'transparent' }}
              >
                <div style={{ color: '#e5eef8' }}>{a.denominacion}</div>
                <div style={{ fontSize: 12, color: '#9fb4ca' }}>
                  Mat. {a.matricula}
                  {a.cuit ? ` · CUIT ${formatearCuit(a.cuit)}` : ' · Extranjera'}
                </div>
              </li>
            ))}
          </ul>
        )}

        {open && !loading && filtered.length === 0 && query.trim() && (
          <div style={{ position: 'absolute', zIndex: 60, left: 0, right: 0, top: '100%', marginTop: 4, background: '#0b2238', border: '1px solid #2c4b68', borderRadius: 8, padding: 12, fontSize: 14, color: '#9fb4ca' }}>
            Sin resultados para "{query}"
          </div>
        )}
      </div>
    </Field>
  );
}

function Field({ label, children }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function normalizar(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n');
}

function formatearCuit(cuit) {
  if (!cuit || cuit.length !== 11) return cuit;
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}
