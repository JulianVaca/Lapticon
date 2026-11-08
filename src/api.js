// Capa de datos: Firebase Auth (REST) + backend Lapticon en Render.
// Si el backend no responde, la app sigue funcionando con datos en memoria.

const BASE_URL = 'https://lapticon-backend-ed.onrender.com'
// Clave web pública de Firebase (identifica el proyecto, no es un secreto).
const FIREBASE_API_KEY = 'AIzaSyAuh64b_I2OtC7KYuubCVx9plEe2pojp2M'

let idToken = null

const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` })

const FIREBASE_ERRORS = {
  INVALID_LOGIN_CREDENTIALS: 'Correo o contraseña incorrectos.',
  INVALID_PASSWORD: 'Contraseña incorrecta.',
  EMAIL_NOT_FOUND: 'No existe una cuenta con ese correo.',
  INVALID_EMAIL: 'El correo no tiene un formato válido.',
  USER_DISABLED: 'Esta cuenta está deshabilitada.',
  MISSING_PASSWORD: 'Escribe tu contraseña.',
}

export async function login(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  )
  const data = await res.json()
  if (!res.ok) {
    const code = (data?.error?.message || '').split(' ')[0]
    if (code.startsWith('TOO_MANY_ATTEMPTS')) throw new Error('Demasiados intentos. Espera un momento e inténtalo otra vez.')
    throw new Error(FIREBASE_ERRORS[code] || 'No pudimos iniciar sesión. Revisa tus datos.')
  }
  idToken = data.idToken
  return { email: data.email, uid: data.localId }
}

export function logout() {
  idToken = null
}

// Llamada a los endpoints públicos del catálogo (requisito del taller).
export async function pingCatalogo() {
  await Promise.all([
    fetch(`${BASE_URL}/api/ciudades/paises`).catch(() => null),
    fetch(`${BASE_URL}/api/ciudades/ciudades`).catch(() => null),
  ])
}

export async function listarEncomiendas() {
  try {
    const res = await fetch(`${BASE_URL}/api/encomiendas`, { headers: authHeaders() })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data) ? data : data.encomiendas || data.data || []
  } catch {
    return null
  }
}

export async function crearEncomienda(encomienda) {
  try {
    const res = await fetch(`${BASE_URL}/api/encomiendas`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(encomienda),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?._id || data?.id || null
  } catch {
    return null
  }
}

export async function cancelarEncomienda(id) {
  try {
    const res = await fetch(`${BASE_URL}/api/encomiendas/${encodeURIComponent(id)}/estado`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ estado: 'cancelada' }),
    })
    return res.ok
  } catch {
    return false
  }
}
