// Torre de control: se carga bajo demanda al iniciar sesión (no pesa en la portada)
import gsap from 'gsap'
import { EarthMap } from './earth.js'
import { HUBS, CITY_LIST, distanceKm, etaLabel, fmtKm } from './hubs.js'
import * as api from './api.js'

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

function scrollToEl(target, offset = -24) {
  if (!target) return
  window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY + offset, behavior: reduce ? 'auto' : 'smooth' })
}

// =====================================================
// Avisos (toasts)
// =====================================================
function toast(msg, type = 'ok') {
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.innerHTML = `<svg><use href="#i-${type === 'ok' ? 'check' : 'alert'}"/></svg><span></span>`
  el.querySelector('span').textContent = msg
  $('#toasts').appendChild(el)
  gsap.fromTo(el, { y: 24, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'power3.out' })
  setTimeout(() => {
    gsap.to(el, { y: -10, opacity: 0, duration: 0.35, ease: 'power2.in', onComplete: () => el.remove() })
  }, 3800)
}

function setStatus(el, msg, type = 'info') {
  el.textContent = msg
  el.dataset.type = type
}

// =====================================================
// Controles segmentados con indicador animado
// =====================================================
function syncSeg(seg) {
  const btn = $('.seg-btn.is-active', seg)
  if (!btn || !seg.offsetWidth) return
  seg.style.setProperty('--x', `${btn.offsetLeft}px`)
  seg.style.setProperty('--w', `${btn.offsetWidth}px`)
}
function selectSeg(seg, btn) {
  $$('.seg-btn', seg).forEach((b) => {
    const on = b === btn
    b.classList.toggle('is-active', on)
    if (b.hasAttribute('aria-checked')) b.setAttribute('aria-checked', String(on))
    else b.setAttribute('aria-pressed', String(on))
  })
  syncSeg(seg)
}
const syncAllSegs = () => $$('.seg').forEach(syncSeg)
window.addEventListener('resize', syncAllSegs)

// =====================================================
// Estado
// =====================================================
const state = {
  origen: 'Bogotá',
  destino: 'New York',
  moneda: 'USD',
  filtro: 'todas',
  encomiendas: [
    {
      _id: 'env-101',
      ciudadOrigen: 'Bogotá',
      ciudadDestino: 'New York',
      valor: 150,
      moneda: 'USD',
      observaciones: 'Documentos urgentes de exportación',
      estado: 'pendiente',
    },
  ],
}
let map = null
const tele = { status: '', progress: '', alt: '' }

function initMap() {
  if (map) return
  map = new EarthMap($('#map-canvas'), {
    interactive: true,
    detail: 'high',
    maxFps: 60,
    labels: 'full',
    tooltip: $('#map-tooltip'),
    onHubClick: (city) => {
      if (city === state.origen) return toast(`${city} ya es el origen. Elige otro hub como destino.`, 'warn')
      state.destino = city
      renderChips()
      updateRoute()
    },
    onFrame: updateTelemetry,
  })
  map.load().then(() => {
    gsap.to('#map-loading', { opacity: 0, duration: 0.4, onComplete: () => ($('#map-loading').hidden = true) })
    updateRoute(true)
  })

  $$('.map-toolbar .seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      selectSeg(b.parentElement, b)
      map.setView(b.dataset.view)
    }),
  )
  $('#zoom-in').addEventListener('click', () => map.zoomBy(1.35))
  $('#zoom-out').addEventListener('click', () => map.zoomBy(1 / 1.35))
  $('#recenter').addEventListener('click', () => map.focusRoute())
}

function updateTelemetry({ t, alt, holding }) {
  const r = map.routes[0]
  let status = 'Crucero'
  if (holding) status = 'En tierra'
  else if (r?.turbo && t < 0.2) status = 'Despegue'
  else if (t < 0.12) status = 'Ascenso'
  else if (t > 0.88) status = 'Descenso'
  const progress = `${Math.round(t * 100)}%`
  const altitude = `${(Math.round((alt * 38000) / 100) * 100).toLocaleString('es-CO')} ft`
  if (status !== tele.status) $('#telemetry-status').textContent = tele.status = status
  if (progress !== tele.progress) {
    $('#telemetry-progress').textContent = tele.progress = progress
    $('#telemetry-bar').style.transform = `scaleX(${t})`
  }
  if (altitude !== tele.alt) $('#telemetry-alt').textContent = tele.alt = altitude
}

function updateRoute(turbo = false) {
  const { origen, destino } = state
  const km = distanceKm(origen, destino)
  $('#ruta-activa-label').textContent = `${origen} → ${destino}`
  $('#kpi-distance').textContent = fmtKm(km)
  $('#kpi-eta').textContent = etaLabel(km)
  $('#telemetry-distance').textContent = fmtKm(km)
  if (!reduce) gsap.fromTo('#ruta-activa-label, #kpi-distance, #kpi-eta', { opacity: 0.2, y: 6 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.05, ease: 'power2.out' })
  map?.setActive(origen, destino, { turbo })
}

function renderChips() {
  for (const [id, key, other] of [
    ['#origen-chips', 'origen', 'destino'],
    ['#destino-chips', 'destino', 'origen'],
  ]) {
    const box = $(id)
    if (!box.children.length) {
      CITY_LIST.forEach((city) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'chip'
        b.dataset.city = city
        b.setAttribute('role', 'radio')
        b.innerHTML = '<span class="chip-code"></span><span class="chip-name"></span>'
        $('.chip-code', b).textContent = HUBS[city].code
        $('.chip-name', b).textContent = city
        b.addEventListener('click', () => {
          if (state[key] === city) return
          // Si eliges la misma ciudad que el otro extremo, se intercambian
          if (state[other] === city) state[other] = state[key]
          state[key] = city
          renderChips()
          updateRoute()
        })
        box.appendChild(b)
      })
    }
    $$('.chip', box).forEach((b) => {
      const on = b.dataset.city === state[key]
      b.classList.toggle('is-active', on)
      b.setAttribute('aria-checked', String(on))
      b.classList.toggle('is-other', b.dataset.city === state[other])
    })
  }
}

const fmtMoney = (v, cur) => {
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: cur, maximumFractionDigits: cur === 'COP' ? 0 : 2 }).format(v)
  } catch {
    return `${v} ${cur}`
  }
}

function renderShipments(animateFirst = false) {
  const list = $('#encomiendas-body')
  const all = state.encomiendas
  const activos = all.filter((e) => (e.estado || 'pendiente').toLowerCase() !== 'cancelada').length
  $('#contador-envios').textContent = String(activos)
  $('#contador-sub').textContent = `en curso · ${all.length} en total`

  const items = all.filter((e) => state.filtro === 'todas' || (e.estado || 'pendiente').toLowerCase() === state.filtro)
  list.replaceChildren()
  $('#ship-empty').hidden = items.length > 0

  items.forEach((item, idx) => {
    const id = item._id || item.id
    const estado = (item.estado || 'pendiente').toLowerCase()
    const o = HUBS[item.ciudadOrigen]
    const d = HUBS[item.ciudadDestino]
    const li = document.createElement('li')
    li.className = `ship ship-${estado}`
    li.tabIndex = 0
    li.setAttribute('role', 'button')
    li.setAttribute('aria-label', `Ver ruta ${item.ciudadOrigen} a ${item.ciudadDestino}`)
    li.innerHTML = `
      <div class="ship-route">
        <span class="ship-code o"></span>
        <span class="ship-line"><svg><use href="#i-plane"/></svg></span>
        <span class="ship-code d"></span>
      </div>
      <div class="ship-info"><strong></strong><span class="muted"></span></div>
      <div class="ship-value"></div>
      <span class="badge"></span>
      <button type="button" class="btn-ghost ship-cancel"></button>`
    $('.ship-code.o', li).textContent = o?.code || item.ciudadOrigen
    $('.ship-code.d', li).textContent = d?.code || item.ciudadDestino
    $('.ship-info strong', li).textContent = `${item.ciudadOrigen} → ${item.ciudadDestino}`
    $('.ship-info .muted', li).textContent = item.observaciones || 'Sin observaciones'
    $('.ship-value', li).textContent = fmtMoney(Number(item.valor) || 0, item.moneda || 'USD')
    $('.badge', li).textContent = estado
    const cancel = $('.ship-cancel', li)
    cancel.textContent = estado === 'cancelada' ? 'Cancelada' : 'Cancelar'
    cancel.disabled = estado === 'cancelada'

    const show = () => {
      if (!HUBS[item.ciudadOrigen] || !HUBS[item.ciudadDestino]) return
      state.origen = item.ciudadOrigen
      state.destino = item.ciudadDestino
      renderChips()
      updateRoute(true)
      scrollToEl($('.map-card'), -90)
    }
    li.addEventListener('click', (e) => !e.target.closest('.ship-cancel') && show())
    li.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === li) {
        e.preventDefault()
        show()
      }
    })

    // Cancelar con confirmación en dos toques
    let armed = null
    cancel.addEventListener('click', async () => {
      if (!armed) {
        cancel.classList.add('is-armed')
        cancel.textContent = '¿Confirmar?'
        armed = setTimeout(() => {
          armed = null
          cancel.classList.remove('is-armed')
          cancel.textContent = 'Cancelar'
        }, 3000)
        return
      }
      clearTimeout(armed)
      cancel.disabled = true
      cancel.textContent = 'Cancelando…'
      await api.cancelarEncomienda(id)
      const found = state.encomiendas.find((e) => (e._id || e.id) === id)
      if (found) found.estado = 'cancelada'
      toast(`Encomienda ${item.ciudadOrigen} → ${item.ciudadDestino} cancelada.`, 'warn')
      renderShipments()
    })

    list.appendChild(li)
    if (animateFirst && idx === 0 && !reduce) {
      gsap.from(li, { height: 0, opacity: 0, y: -12, duration: 0.6, ease: 'power3.out', clearProps: 'all' })
    }
  })
}

function bindAppControls() {
  $('#swap-btn').addEventListener('click', (e) => {
    ;[state.origen, state.destino] = [state.destino, state.origen]
    if (!reduce) gsap.fromTo(e.currentTarget.querySelector('svg'), { rotate: 0 }, { rotate: 180, duration: 0.5, ease: 'power3.inOut' })
    renderChips()
    updateRoute()
  })

  const monedaSeg = $('#moneda-seg')
  $$('.seg-btn', monedaSeg).forEach((b) =>
    b.addEventListener('click', () => {
      state.moneda = b.dataset.moneda
      selectSeg(monedaSeg, b)
    }),
  )

  const filterSeg = $('#filter-seg')
  $$('.seg-btn', filterSeg).forEach((b) =>
    b.addEventListener('click', () => {
      state.filtro = b.dataset.filter
      selectSeg(filterSeg, b)
      renderShipments()
    }),
  )

  $('#encomienda-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const statusEl = $('#encomienda-status')
    const valorEl = $('#valor-input')
    const obsEl = $('#observaciones-input')
    const valor = Number(valorEl.value)
    const observaciones = obsEl.value.trim()

    valorEl.classList.toggle('is-invalid', !(valor > 0))
    obsEl.classList.toggle('is-invalid', !observaciones)
    if (!(valor > 0) || !observaciones) {
      setStatus(statusEl, !(valor > 0) ? 'Escribe un valor mayor que cero.' : 'Agrega una breve descripción del paquete.', 'warn')
      ;(!(valor > 0) ? valorEl : obsEl).focus()
      if (!reduce) gsap.fromTo('#encomienda-form', { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)' })
      return
    }

    const btn = $('#dispatch-btn')
    btn.classList.add('is-loading')
    btn.disabled = true
    setStatus(statusEl, 'Registrando envío y preparando despegue…', 'info')

    const nueva = {
      _id: `env-${Date.now()}`,
      ciudadOrigen: state.origen,
      ciudadDestino: state.destino,
      valor,
      moneda: state.moneda,
      observaciones,
      estado: 'pendiente',
    }
    const remoteId = await api.crearEncomienda(nueva)
    if (remoteId) nueva._id = remoteId

    state.encomiendas.unshift(nueva)
    btn.classList.remove('is-loading')
    btn.disabled = false
    valorEl.value = ''
    obsEl.value = ''
    setStatus(statusEl, '', 'info')
    toast(`Encomienda creada · vuelo ${state.origen} → ${state.destino} despegando.`)
    updateRoute(true)
    if (state.filtro === 'cancelada') {
      state.filtro = 'todas'
      selectSeg(filterSeg, $('[data-filter="todas"]', filterSeg))
    }
    renderShipments(true)
  })

  $$('#valor-input, #observaciones-input').forEach((el) => el.addEventListener('input', () => el.classList.remove('is-invalid')))

  $('#logout-btn').addEventListener('click', () => {
    api.logout()
    gsap.to('#app', {
      opacity: 0,
      duration: 0.4,
      onComplete: () => {
        $('#app').hidden = true
        $('#landing').hidden = false
        gsap.set('#app', { opacity: 1 })
        $('#login-form').reset()
        setStatus($('#login-status'), '', 'info')
        window.scrollTo(0, 0)
        gsap.fromTo('#landing', { opacity: 0 }, { opacity: 1, duration: 0.6 })
      },
    })
  })
}
bindAppControls()

export async function enterApp(user) {
  const remotas = await api.listarEncomiendas()
  if (remotas && remotas.length) state.encomiendas = remotas
  $('#welcome-message').textContent = user.email
  $('#user-avatar').textContent = (user.email || 'L')[0].toUpperCase()
  const tl = gsap.timeline()
  tl.to('#landing', { opacity: 0, scale: 0.985, duration: reduce ? 0 : 0.5, ease: 'power2.in' }).add(() => {
    $('#landing').hidden = true
    gsap.set('#landing', { opacity: 1, scale: 1 })
    $('#app').hidden = false
    window.scrollTo(0, 0)
    renderChips()
    renderShipments()
    initMap()
    syncAllSegs()
    document.fonts?.ready.then(syncAllSegs)
    if (!reduce) {
      gsap
        .timeline({ defaults: { ease: 'power3.out' } })
        .from('.app-bar', { y: -24, opacity: 0, duration: 0.7 })
        .from('.kpi', { y: 24, opacity: 0, duration: 0.7, stagger: 0.07 }, 0.1)
        .from('.map-card', { y: 30, opacity: 0, scale: 0.98, duration: 0.9 }, 0.2)
        .from('.side .panel', { x: 30, opacity: 0, duration: 0.8, stagger: 0.1 }, 0.3)
        .from('.shipments', { y: 30, opacity: 0, duration: 0.8 }, 0.45)
    }
  })
}
