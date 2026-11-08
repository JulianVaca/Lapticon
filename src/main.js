// PORTADA ligera: sin GSAP, Lenis ni d3 al cargar.
// Las animaciones de entrada y scroll son CSS (las ejecuta la GPU, fuera del hilo principal).
// El globo y la torre de control se cargan solo cuando hacen falta.
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import './styles/main.css'

import { HUBS, CITY_LIST } from './hubs.js'

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const canHover = window.matchMedia('(hover: hover)').matches
const root = document.documentElement

// Precarga de la app (GSAP + mapa) cuando el usuario muestra intención de entrar
let appModule = null
const loadApp = () => (appModule ||= Promise.all([import('./api.js'), import('./app.js')]))

// =====================================================
// Anclas con scroll nativo suave
// =====================================================
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]')
  if (!a) return
  const id = a.getAttribute('href')
  if (id.length < 2) return
  const t = document.querySelector(id)
  if (!t) return
  e.preventDefault()
  const offset = id === '#acceso' ? -120 : -24
  window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY + offset, behavior: reduce ? 'auto' : 'smooth' })
  if (id === '#acceso') setTimeout(() => $('#login-email').focus({ preventScroll: true }), 700)
})

// =====================================================
// Contadores de la portada
// =====================================================
function countUp(el, delay) {
  const end = Number(el.dataset.count)
  const suffix = el.dataset.suffix || ''
  const fmt = (v) => Math.round(v).toLocaleString('es-CO') + suffix
  if (reduce) return (el.textContent = fmt(end))
  const dur = 1600
  setTimeout(() => {
    const t0 = performance.now()
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur)
      el.textContent = fmt(end * (1 - Math.pow(1 - p, 3)))
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, delay)
}
$$('[data-count]').forEach((el, i) => countUp(el, 400 + i * 80))

// =====================================================
// Revelados al hacer scroll: IntersectionObserver + transiciones CSS
// =====================================================
// (el CSS oculta [data-reveal] solo con html.js y sin "reducir movimiento")
if (reduce) {
  root.classList.remove('js')
} else {
  $$('[data-reveal-stagger]').forEach((list) => [...list.children].forEach((c, i) => c.style.setProperty('--i', i)))
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('is-in')
        io.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  )
  const observeAll = () => $$('[data-reveal], [data-reveal-stagger]').forEach((el) => io.observe(el))
  observeAll()
}

// =====================================================
// Lista de hubs + globo vitrina (d3 y el mapa se cargan al acercarse)
// =====================================================
let showcase = null
function buildHubList() {
  const list = $('#hub-list')
  CITY_LIST.forEach((city, i) => {
    const h = HUBS[city]
    const [lon, lat] = h.coords
    const li = document.createElement('li')
    li.style.setProperty('--i', i)
    li.innerHTML = `<button type="button" class="hub-item"><span class="hub-code"></span><span class="hub-name"><strong></strong><small></small></span><span class="hub-coord"></span></button>`
    $('.hub-code', li).textContent = h.code
    $('strong', li).textContent = city
    $('small', li).textContent = h.country
    $('.hub-coord', li).textContent = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'O'}`
    const focus = () => {
      if (!showcase) return
      showcase.active = { from: city, to: null }
      showcase.opts.autoRotate = 0
      showcase.flyTo(h.coords, 1.25, 1.1)
    }
    $('button', li).addEventListener('click', focus)
    if (canHover) $('button', li).addEventListener('pointerenter', focus)
    list.appendChild(li)
  })
  list.addEventListener('pointerleave', () => {
    if (!showcase) return
    showcase.active = { from: null, to: null }
    showcase.opts.autoRotate = 7
  })
}

function initShowcase() {
  const canvas = $('#showcase-canvas')
  let started = false
  const start = async () => {
    if (started) return
    started = true
    io.disconnect()
    for (const ev of GESTURES) window.removeEventListener(ev, onGesture)
    const { EarthMap } = await import('./earth.js')
    // el globo solo se dibuja mientras está visible (IntersectionObserver interno)
    showcase = new EarthMap(canvas, { interactive: false, autoRotate: 7, detail: 'low', labels: 'code', maxFps: 30, maxDpr: 1.5 })
    showcase.rot = [80, -8]
    // Pausa el globo mientras la página se desplaza: el scroll queda con todo el hilo libre
    let resume = null
    window.addEventListener(
      'scroll',
      () => {
        showcase.paused = true
        clearTimeout(resume)
        resume = setTimeout(() => (showcase.paused = false), 140)
      },
      { passive: true },
    )
    await showcase.load()
    showcase.setRoutes([
      { from: 'Bogotá', to: 'New York' },
      { from: 'México', to: 'Toronto' },
      { from: 'São Paulo', to: 'New York' },
      { from: 'Medellín', to: 'México' },
      { from: 'São Paulo', to: 'Bogotá' },
      { from: 'Toronto', to: 'Medellín' },
    ])
  }
  // Se prepara en el primer gesto del usuario (en un momento libre), antes de llegar a la sección,
  // o al acercarse si se llega directo con un enlace.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200))
  const GESTURES = ['scroll', 'pointerdown', 'touchstart', 'keydown', 'wheel']
  const onGesture = () => idle(start, { timeout: 1200 })
  for (const ev of GESTURES) window.addEventListener(ev, onGesture, { once: true, passive: true })
  const io = new IntersectionObserver(([e]) => e.isIntersecting && start(), { rootMargin: '200px' })
  io.observe(canvas)
}

// =====================================================
// Acceso
// =====================================================
function setStatus(el, msg, type = 'info') {
  el.textContent = msg
  el.dataset.type = type
}

function bindLogin() {
  const form = $('#login-form')
  // Empieza a descargar la app en cuanto el usuario va a escribir
  form.addEventListener('focusin', loadApp, { once: true })
  form.addEventListener('pointerenter', loadApp, { once: true })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const statusEl = $('#login-status')
    const email = $('#login-email').value.trim()
    const password = $('#login-password').value
    if (!email || !password) {
      setStatus(statusEl, 'Escribe tu correo y tu contraseña.', 'warn')
      ;(!email ? $('#login-email') : $('#login-password')).focus()
      return
    }
    const btn = $('#login-btn')
    btn.classList.add('is-loading')
    btn.disabled = true
    setStatus(statusEl, 'Verificando credenciales…', 'info')
    try {
      const [api, app] = await loadApp()
      const user = await api.login(email, password)
      setStatus(statusEl, 'Acceso concedido.', 'ok')
      api.pingCatalogo()
      await app.enterApp(user)
    } catch (err) {
      setStatus(statusEl, err.message || 'Error de conexión. Inténtalo de nuevo.', 'error')
      const card = $('.login-card')
      card.classList.remove('shake')
      void card.offsetWidth
      if (!reduce) card.classList.add('shake')
    } finally {
      btn.classList.remove('is-loading')
      btn.disabled = false
    }
  })
}

buildHubList()
initShowcase()
bindLogin()
