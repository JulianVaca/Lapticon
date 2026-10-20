console.log("¡El script.js se cargó correctamente en Codespaces!");

const BASE_URL = "https://lapticon-backend-ed.onrender.com";
const FIREBASE_API_KEY = "AIzaSyAuh64b_I2OtC7KYuubCVx9plEe2pojp2M";

let idToken = null;
let uid = null;

// ==========================================
// Bloque 1: Login
// ==========================================
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value.trim();
  const loginStatus = document.getElementById("login-status");

  loginStatus.textContent = "Conectando con Firebase...";
  loginStatus.style.color = "#2563eb";

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data?.error?.message || "Credenciales incorrectas";
      loginStatus.textContent = `Error: ${errorMsg}`;
      loginStatus.style.color = "#dc2626";
      return;
    }

    // Guardar token y uid
    idToken = data.idToken;
    uid = data.localId;

    // Cambiar vistas
    document.getElementById("welcome-message").textContent = `¡Bienvenido, ${data.email}!`;
    document.getElementById("login-section").hidden = true;
    document.getElementById("app-section").hidden = false;

    // Cargar datos iniciales
    await cargarCiudades();
    await cargarEncomiendas();
  } catch (error) {
    loginStatus.textContent = "Error de red al conectar con Firebase.";
    loginStatus.style.color = "#dc2626";
    console.error("Error en login:", error);
  }
});

// ==========================================
// Bloque 2: Catálogo de ciudades (Con respaldo automático)
// ==========================================
async function cargarCiudades() {
  const origenSelect = document.getElementById("origen-select");
  const destinoSelect = document.getElementById("destino-select");

  origenSelect.innerHTML = '<option value="">Cargando ciudades...</option>';
  destinoSelect.innerHTML = '<option value="">Cargando ciudades...</option>';

  let listaCiudades = [];

  try {
    const [paisesRes, ciudadesRes] = await Promise.all([
      fetch(`${BASE_URL}/api/ciudades/paises`),
      fetch(`${BASE_URL}/api/ciudades/ciudades`),
    ]);

    const ciudadesData = await ciudadesRes.json().catch(() => []);

    if (Array.isArray(ciudadesData)) {
      listaCiudades = ciudadesData;
    } else if (ciudadesData.ciudades && Array.isArray(ciudadesData.ciudades)) {
      listaCiudades = ciudadesData.ciudades;
    } else if (ciudadesData.data && Array.isArray(ciudadesData.data)) {
      listaCiudades = ciudadesData.data;
    }
  } catch (error) {
    console.warn("Backend lento o inactivo, usando respaldo local de ciudades.");
  }

  // Lista de respaldo por si Render está dormido
  if (!listaCiudades || listaCiudades.length === 0) {
    listaCiudades = [
      "Bogotá",
      "Medellín",
      "Cali",
      "Barranquilla",
      "Cartagena",
      "Cúcuta",
      "Bucaramanga",
      "Pereira",
      "Miami",
      "Madrid",
      "Ciudad de México",
      "Buenos Aires"
    ];
  }

  origenSelect.innerHTML = '<option value="">-- Selecciona origen --</option>';
  destinoSelect.innerHTML = '<option value="">-- Selecciona destino --</option>';

  listaCiudades.forEach((item) => {
    const nombreCiudad = typeof item === "string" ? item : item.nombre || item.ciudad || item.name;

    if (nombreCiudad) {
      const option1 = document.createElement("option");
      option1.value = nombreCiudad;
      option1.textContent = nombreCiudad;
      origenSelect.appendChild(option1);

      const option2 = document.createElement("option");
      option2.value = nombreCiudad;
      option2.textContent = nombreCiudad;
      destinoSelect.appendChild(option2);
    }
  });
}

// ==========================================
// Bloque 3: Registrar encomienda
// ==========================================
document.getElementById("encomienda-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const statusEl = document.getElementById("encomienda-status");
  const ciudadOrigen = document.getElementById("origen-select").value;
  const ciudadDestino = document.getElementById("destino-select").value;
  const valor = document.getElementById("valor-input").value.trim();
  const moneda = document.getElementById("moneda-select").value;
  const observaciones = document.getElementById("observaciones-input").value.trim();

  if (!ciudadOrigen || !ciudadDestino || !valor || !observaciones) {
    statusEl.textContent = "Por favor completa todos los campos.";
    statusEl.style.color = "#dc2626";
    return;
  }

  statusEl.textContent = "Guardando encomienda...";
  statusEl.style.color = "#2563eb";

  try {
    const res = await fetch(`${BASE_URL}/api/encomiendas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        ciudadOrigen,
        ciudadDestino,
        valor: Number(valor),
        moneda,
        observaciones,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      statusEl.textContent = `Error: ${data.message || "No se pudo registrar"}`;
      statusEl.style.color = "#dc2626";
      return;
    }

    statusEl.textContent = "¡Encomienda creada con éxito!";
    statusEl.style.color = "#16a34a";
    document.getElementById("encomienda-form").reset();

    await cargarEncomiendas();
  } catch (error) {
    statusEl.textContent = "Error de red al registrar la encomienda.";
    statusEl.style.color = "#dc2626";
    console.error("Error creando encomienda:", error);
  }
});

// ==========================================
// Bloque 4: Listar mis encomiendas
// ==========================================
async function cargarEncomiendas() {
  const tbody = document.getElementById("encomiendas-body");
  tbody.innerHTML = '<tr><td colspan="5">Cargando encomiendas...</td></tr>';

  try {
    const res = await fetch(`${BASE_URL}/api/encomiendas`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = await res.json();

    tbody.innerHTML = "";
    const lista = Array.isArray(data) ? data : data.encomiendas || data.data || [];

    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No hay encomiendas registradas.</td></tr>';
      return;
    }

    lista.forEach((item) => {
      const id = item._id || item.id;
      const estado = item.estado || "pendiente";

      const tr = document.createElement("tr");

      const tdOrigen = document.createElement("td");
      tdOrigen.textContent = item.ciudadOrigen;

      const tdDestino = document.createElement("td");
      tdDestino.textContent = item.ciudadDestino;

      const tdEstado = document.createElement("td");
      tdEstado.textContent = estado;

      const tdValor = document.createElement("td");
      tdValor.textContent = `${item.valor} ${item.moneda}`;

      const tdAcciones = document.createElement("td");
      const btnCancelar = document.createElement("button");
      btnCancelar.textContent = "Cancelar";
      
      if (estado.toLowerCase() === "cancelada") {
        btnCancelar.disabled = true;
        btnCancelar.textContent = "Cancelada";
      }

      btnCancelar.addEventListener("click", () => {
        cancelarEncomienda(id, tdEstado, btnCancelar);
      });

      tdAcciones.appendChild(btnCancelar);

      tr.appendChild(tdOrigen);
      tr.appendChild(tdDestino);
      tr.appendChild(tdEstado);
      tr.appendChild(tdValor);
      tr.appendChild(tdAcciones);

      tbody.appendChild(tr);
    });
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:red;">Error al cargar lista.</td></tr>';
    console.error("Error listando encomiendas:", error);
  }
}

// ==========================================
// Bloque 5: Cambiar estado (Reto opcional)
// ==========================================
async function cancelarEncomienda(id, tdEstado, btn) {
  btn.disabled = true;
  btn.textContent = "Cancelando...";

  try {
    const res = await fetch(`${BASE_URL}/api/encomiendas/${id}/estado`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ estado: "cancelada" }),
    });

    if (!res.ok) {
      alert("No se pudo cancelar la encomienda.");
      btn.disabled = false;
      btn.textContent = "Cancelar";
      return;
    }

    tdEstado.textContent = "cancelada";
    btn.textContent = "Cancelada";
  } catch (error) {
    console.error("Error cancelando:", error);
    alert("Error de red.");
    btn.disabled = false;
    btn.textContent = "Cancelar";
  }
}