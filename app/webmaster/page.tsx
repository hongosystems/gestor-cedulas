"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type User = {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  is_superadmin: boolean;
  is_admin_expedientes: boolean;
  is_admin_cedulas: boolean;
  is_admin_mediaciones: boolean;
  is_abogado: boolean;
  must_change_password: boolean;
  juzgados: string[];
};

export default function WebMasterPage() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [msg, setMsg] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Formulario
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formFullName, setFormFullName] = useState("");
  const [formIsSuperadmin, setFormIsSuperadmin] = useState(false);
  const [formIsAdminExpedientes, setFormIsAdminExpedientes] = useState(false);
  const [formIsAdminCedulas, setFormIsAdminCedulas] = useState(false);
  const [formIsAdminMediaciones, setFormIsAdminMediaciones] = useState(false);
  const [formIsAbogado, setFormIsAbogado] = useState(false);
  const [formJuzgados, setFormJuzgados] = useState<string[]>([]);
  const [newJuzgado, setNewJuzgado] = useState("");
  const [csvJuzgados, setCsvJuzgados] = useState("");

  useEffect(() => {
    checkAuthAndLoadUsers();
  }, []);

  async function checkAuthAndLoadUsers() {
    try {
      setLoading(true);
      const { data: session } = await supabase.auth.getSession();
      
      if (!session.session) {
        window.location.href = "/webmaster/login";
        return;
      }

      // Verificar que es superadmin
      const { data: roleData, error: roleErr } = await supabase
        .from("user_roles")
        .select("is_superadmin")
        .eq("user_id", session.session.user.id)
        .maybeSingle();

      if (roleErr || !roleData || roleData.is_superadmin !== true) {
        window.location.href = "/webmaster/login";
        return;
      }

      await loadUsers();
    } catch (error: any) {
      setMsg(`Error: ${error.message}`);
      setLoading(false);
    }
  }

  async function loadUsers() {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return;

      const token = session.session.access_token;

      const response = await fetch("/api/webmaster/users", {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Error al cargar usuarios");
      }

      const data = await response.json();
      setUsers(data.users || []);
      setMsg("");
    } catch (error: any) {
      setMsg(`Error al cargar usuarios: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  function openModal(user?: User) {
    if (user) {
      setEditingUser(user);
      setFormEmail(user.email);
      setFormPassword("");
      setFormFullName(user.full_name);
      setFormIsSuperadmin(user.is_superadmin);
      setFormIsAdminExpedientes(user.is_admin_expedientes);
      setFormIsAdminCedulas(user.is_admin_cedulas);
      setFormIsAdminMediaciones(!!user.is_admin_mediaciones);
      setFormIsAbogado(user.is_abogado);
      setFormJuzgados([...user.juzgados]);
    } else {
      setEditingUser(null);
      setFormEmail("");
      setFormPassword("");
      setFormFullName("");
      setFormIsSuperadmin(false);
      setFormIsAdminExpedientes(false);
      setFormIsAdminCedulas(false);
      setFormIsAdminMediaciones(false);
      setFormIsAbogado(false);
      setFormJuzgados([]);
    }
    setNewJuzgado("");
    setCsvJuzgados("");
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingUser(null);
    setMsg("");
  }

  function addJuzgado() {
    if (newJuzgado.trim() && !formJuzgados.includes(newJuzgado.trim().toUpperCase())) {
      setFormJuzgados([...formJuzgados, newJuzgado.trim().toUpperCase()]);
      setNewJuzgado("");
    }
  }

  function removeJuzgado(index: number) {
    setFormJuzgados(formJuzgados.filter((_, i) => i !== index));
  }

  function loadJuzgadosFromCSV() {
    if (!csvJuzgados.trim()) return;

    // Procesar la lista separada por comas
    const juzgados = csvJuzgados
      .split(",")
      .map(j => j.trim())
      .filter(j => j.length > 0)
      .map(j => j.toUpperCase());

    // Eliminar duplicados dentro de la lista CSV
    const juzgadosUnicos = [...new Set(juzgados)];

    // Agregar solo los que no estén ya en la lista
    const nuevosJuzgados = juzgadosUnicos.filter(j => !formJuzgados.includes(j));
    
    if (nuevosJuzgados.length > 0) {
      // También eliminar duplicados del estado actual por si acaso
      const juzgadosActualizados = [...new Set([...formJuzgados, ...nuevosJuzgados])];
      setFormJuzgados(juzgadosActualizados);
      setCsvJuzgados("");
      setMsg(`Se agregaron ${nuevosJuzgados.length} juzgado(s) correctamente.`);
      setTimeout(() => setMsg(""), 3000);
    } else {
      setMsg("Todos los juzgados ya están agregados.");
      setTimeout(() => setMsg(""), 3000);
    }
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!formEmail || !formFullName) {
      setMsg("Email y nombre completo son obligatorios");
      return;
    }

    if (!editingUser && !formPassword) {
      setMsg("La contraseña es obligatoria para nuevos usuarios");
      return;
    }

    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        setMsg("Sesión expirada. Por favor, inicia sesión nuevamente.");
        return;
      }

      const token = session.session.access_token;
      const url = editingUser 
        ? `/api/webmaster/users/${editingUser.id}`
        : "/api/webmaster/users";
      
      const method = editingUser ? "PUT" : "POST";

      const body: any = {
        email: formEmail,
        full_name: formFullName,
        is_superadmin: formIsSuperadmin,
        is_admin_expedientes: formIsAdminExpedientes,
        is_admin_cedulas: formIsAdminCedulas,
        is_admin_mediaciones: formIsAdminMediaciones,
        is_abogado: formIsAbogado,
      };

      if (formPassword) {
        body.password = formPassword;
      }

      // Siempre enviar juzgados si es abogado (incluso si está vacío)
      // Eliminar duplicados antes de enviar para evitar errores en la API
      if (formIsAbogado) {
        const juzgadosUnicos = formJuzgados ? [...new Set(formJuzgados)] : [];
        body.juzgados = juzgadosUnicos;
      }

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Error al guardar usuario");
      }

      setMsg(editingUser ? "Usuario actualizado correctamente" : "Usuario creado correctamente");
      await loadUsers();
      setTimeout(() => {
        closeModal();
        setMsg("");
      }, 1500);
    } catch (error: any) {
      setMsg(`Error: ${error.message}`);
    }
  }

  async function deleteUser(userId: string, email: string) {
    if (!confirm(`¿Estás seguro de que querés eliminar al usuario "${email}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        setMsg("Sesión expirada. Por favor, inicia sesión nuevamente.");
        return;
      }

      const token = session.session.access_token;

      const response = await fetch(`/api/webmaster/users/${userId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Error al eliminar usuario");
      }

      setMsg("Usuario eliminado correctamente");
      await loadUsers();
      setTimeout(() => setMsg(""), 2000);
    } catch (error: any) {
      setMsg(`Error: ${error.message}`);
    }
  }

  function formatDate(dateStr: string) {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    return date.toLocaleDateString("es-AR", { 
      year: "numeric", 
      month: "2-digit", 
      day: "2-digit" 
    });
  }

  const filteredUsers = users.filter(u => {
    const search = searchTerm.toLowerCase();
    return (
      u.email.toLowerCase().includes(search) ||
      u.full_name.toLowerCase().includes(search)
    );
  });

  if (loading) {
    return (
      <main className="container">
        <section className="card">
          <div className="page">
            <p className="helper">Cargando…</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="card">
        <header className="nav">
          <div>
            <h1>Backoffice - Gestión de Usuarios</h1>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              Administrá usuarios, roles y juzgados asignados
            </div>
          </div>
          <div className="spacer" />
          <button
            className="btn danger"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/webmaster/login";
            }}
          >
            Salir
          </button>
        </header>

        <div className="page">
          {msg && (
            <div className={msg.includes("Error") ? "error" : ""} style={{
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: 12,
              border: msg.includes("Error") 
                ? "1px solid rgba(225,57,64,.45)"
                : "1px solid rgba(0,169,82,.45)",
              background: msg.includes("Error")
                ? "rgba(225,57,64,.12)"
                : "rgba(0,169,82,.12)",
              color: msg.includes("Error")
                ? "rgba(255,235,235,.95)"
                : "rgba(235,255,245,.95)",
            }}>
              {msg}
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              className="input"
              placeholder="Buscar por email o nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ flex: "1 1 300px", minWidth: 200 }}
            />
            <button className="btn primary" onClick={() => openModal()}>
              ➕ Crear Usuario
            </button>
          </div>

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Nombre</th>
                  <th>Roles</th>
                  <th>Juzgados</th>
                  <th>Fecha Creación</th>
                  <th style={{ width: 120 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted" style={{ textAlign: "center", padding: "40px 20px" }}>
                      {searchTerm ? "No se encontraron usuarios" : "No hay usuarios registrados"}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id}>
                      <td style={{ fontWeight: 600 }}>{user.email}</td>
                      <td>{user.full_name || <span className="muted">Sin nombre</span>}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {user.is_superadmin && (
                            <span className="badge badge--gris" style={{ fontSize: 11, padding: "4px 8px" }}>
                              SuperAdmin
                            </span>
                          )}
                          {user.is_admin_expedientes && (
                            <span className="badge badge--gris" style={{ fontSize: 11, padding: "4px 8px" }}>
                              Admin Expedientes
                            </span>
                          )}
                          {user.is_admin_cedulas && (
                            <span className="badge badge--gris" style={{ fontSize: 11, padding: "4px 8px" }}>
                              Admin Cédulas
                            </span>
                          )}
                          {user.is_admin_mediaciones && (
                            <span className="badge badge--gris" style={{ fontSize: 11, padding: "4px 8px" }}>
                              Admin Mediaciones
                            </span>
                          )}
                          {user.is_abogado && (
                            <span className="badge badge--gris" style={{ fontSize: 11, padding: "4px 8px" }}>
                              Abogado
                            </span>
                          )}
                          {!user.is_superadmin && !user.is_admin_expedientes && !user.is_admin_cedulas && !user.is_admin_mediaciones && !user.is_abogado && (
                            <span className="muted" style={{ fontSize: 12 }}>Sin roles</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {user.is_abogado && user.juzgados.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {user.juzgados.slice(0, 2).map((j, idx) => (
                              <span key={idx} style={{ fontSize: 12, color: "var(--text)" }}>
                                {j}
                              </span>
                            ))}
                            {user.juzgados.length > 2 && (
                              <span className="muted" style={{ fontSize: 11 }}>
                                +{user.juzgados.length - 2} más
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: 13 }}>{formatDate(user.created_at)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            className="btn"
                            onClick={() => openModal(user)}
                            style={{ padding: "6px 10px", fontSize: 13 }}
                          >
                            ✏️ Editar
                          </button>
                          <button
                            className="btn danger"
                            onClick={() => deleteUser(user.id, user.email)}
                            style={{ padding: "6px 10px", fontSize: 13 }}
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Modal para crear/editar usuario */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
            backdropFilter: "blur(4px)",
          }}
          onClick={closeModal}
        >
          <div
            style={{
              maxWidth: 600,
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              background: "linear-gradient(180deg, #0b2f55 0%, #071c2e 100%)",
              border: "1px solid rgba(255,255,255,.2)",
              borderRadius: 18,
              boxShadow: "0 24px 48px rgba(0,0,0,.8), 0 8px 16px rgba(0,0,0,.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 24px",
                borderBottom: "1px solid rgba(255,255,255,.15)",
                background: "linear-gradient(90deg, rgba(0,82,156,.35), rgba(255,255,255,.05))",
              }}
            >
              <h1 style={{ margin: 0, fontSize: 20, letterSpacing: ".2px", color: "var(--text)" }}>
                {editingUser ? "Editar Usuario" : "Crear Usuario"}
              </h1>
              <div style={{ flex: 1 }} />
              <button
                className="btn"
                onClick={closeModal}
                style={{
                  padding: "6px 12px",
                  background: "rgba(255,255,255,.08)",
                  border: "1px solid rgba(255,255,255,.16)",
                }}
              >
                ✕
              </button>
            </header>
            <div style={{ padding: "24px 24px 32px 24px" }}>
              <form className="form" onSubmit={saveUser}>
                <div className="field">
                  <div className="label">Email *</div>
                  <input
                    className="input"
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    required
                    disabled={!!editingUser}
                  />
                </div>

                <div className="field">
                  <div className="label">Nombre Completo *</div>
                  <input
                    className="input"
                    type="text"
                    value={formFullName}
                    onChange={(e) => setFormFullName(e.target.value)}
                    required
                  />
                </div>

                <div className="field">
                  <div className="label">
                    Contraseña {!editingUser && "*"} {editingUser && "(dejar vacío para no cambiar)"}
                  </div>
                  <input
                    className="input"
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    required={!editingUser}
                  />
                </div>

                <div className="field">
                  <div className="label">Roles</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={formIsSuperadmin}
                        onChange={(e) => setFormIsSuperadmin(e.target.checked)}
                      />
                      <span>SuperAdmin</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={formIsAdminExpedientes}
                        onChange={(e) => setFormIsAdminExpedientes(e.target.checked)}
                      />
                      <span>Admin Expedientes</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={formIsAdminCedulas}
                        onChange={(e) => setFormIsAdminCedulas(e.target.checked)}
                      />
                      <span>Admin Cédulas</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!formIsAdminMediaciones}
                        onChange={(e) => setFormIsAdminMediaciones(e.target.checked)}
                      />
                      <span>Admin Mediaciones</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={formIsAbogado}
                        onChange={(e) => {
                          setFormIsAbogado(e.target.checked);
                          if (!e.target.checked) {
                            setFormJuzgados([]);
                          }
                        }}
                      />
                      <span>Abogado</span>
                    </label>
                  </div>
                </div>

                {formIsAbogado && (
                  <div className="field">
                    <div className="label">Juzgados Asignados</div>
                    
                    {/* Carga masiva desde CSV/texto separado por comas */}
                    <div style={{ marginBottom: 16 }}>
                      <div className="label" style={{ fontSize: 13, marginBottom: 6, color: "rgba(234,243,255,.7)" }}>
                        Cargar múltiples juzgados (separados por coma):
                      </div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <textarea
                          className="input"
                          placeholder="Ej: JUZGADO CIVIL 21, JUZGADO CIVIL 45, JUZGADO NACIONAL EN LO CIVIL N° 89, ..."
                          value={csvJuzgados}
                          onChange={(e) => setCsvJuzgados(e.target.value)}
                          style={{ 
                            flex: 1, 
                            minHeight: 80, 
                            fontFamily: "monospace",
                            fontSize: 13,
                            resize: "vertical"
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn"
                        onClick={loadJuzgadosFromCSV}
                        disabled={!csvJuzgados.trim()}
                        style={{ marginBottom: 16 }}
                      >
                        📥 Cargar Juzgados desde Lista
                      </button>
                    </div>

                    {/* Separador visual */}
                    <div style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      gap: 12, 
                      marginBottom: 12,
                      marginTop: 8
                    }}>
                      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.1)" }} />
                      <span style={{ fontSize: 12, color: "rgba(234,243,255,.5)" }}>O agregar uno por uno</span>
                      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.1)" }} />
                    </div>

                    {/* Agregar juzgado individual */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <input
                        className="input"
                        type="text"
                        placeholder="Ej: JUZGADO NACIONAL EN LO CIVIL N° 89"
                        value={newJuzgado}
                        onChange={(e) => setNewJuzgado(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addJuzgado();
                          }
                        }}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={addJuzgado}
                        disabled={!newJuzgado.trim()}
                      >
                        Agregar
                      </button>
                    </div>
                    {formJuzgados.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {formJuzgados.map((j, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "8px 12px",
                              background: "rgba(255,255,255,.04)",
                              borderRadius: 8,
                              border: "1px solid rgba(255,255,255,.08)",
                            }}
                          >
                            <span style={{ fontSize: 13 }}>{j}</span>
                            <button
                              type="button"
                              className="btn danger"
                              onClick={() => removeJuzgado(idx)}
                              style={{ padding: "4px 8px", fontSize: 12 }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="actions">
                  <button className="btn" type="button" onClick={closeModal}>
                    Cancelar
                  </button>
                  <button className="btn primary" type="submit">
                    {editingUser ? "Actualizar" : "Crear"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
