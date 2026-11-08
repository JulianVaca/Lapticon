// Globo terráqueo / mapa plano renderizado en <canvas> con cartografía real (Natural Earth).
// Capa base (océano, países, noche, iluminación) cacheada en un canvas fuera de pantalla;
// la capa de rutas, aviones y hubs se dibuja en cada frame encima.
import {
  geoOrthographic,
  geoNaturalEarth1,
  geoPath,
  geoGraticule10,
  geoInterpolate,
  geoDistance,
  geoCentroid,
  geoCircle,
  geoContains,
  geoRotation,
} from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import gsap from 'gsap'
import atlasLoUrl from 'world-atlas/countries-110m.json?url'
import atlasHiUrl from 'world-atlas/countries-50m.json?url'
import { HUBS, CITY_LIST } from './hubs.js'

const C = {
  origin: '#e8b45a',
  dest: '#62cdc2',
  ivory: '#f3eee4',
  coast: 'rgba(240, 230, 205, 0.32)',
  border: 'rgba(16, 26, 18, 0.5)',
  graticule: 'rgba(207, 227, 223, 0.075)',
}

// Biomas aproximados por latitud del centroide de cada país: paleta tierra real.
const BIOMES = {
  ice: [226, 233, 228],
  tundra: [150, 160, 132],
  boreal: [78, 104, 70],
  temperate: [104, 128, 76],
  arid: [196, 163, 108],
  savanna: [150, 140, 84],
  tropical: [58, 98, 56],
}

const PLANE = new Path2D(
  'M13 0 L4.5 -1.7 L-0.5 -9.5 L-3.2 -9.5 L-0.8 -1.7 L-6.4 -1.5 L-8.8 -4.6 L-10.4 -4.6 L-9 0 L-10.4 4.6 L-8.8 4.6 L-6.4 1.5 L-0.8 1.7 L-3.2 9.5 L-0.5 9.5 L4.5 1.7 Z',
)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const rgb = (c, a = 1) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

function biomeColor(lon, lat, seed) {
  const a = Math.abs(lat)
  let base
  if (a > 66) base = BIOMES.ice
  else if (a > 56) base = BIOMES.tundra
  else if (a > 46) base = BIOMES.boreal
  else if (a > 34) base = BIOMES.temperate
  else if (a > 16) base = (lon > -20 && lon < 75) || (lon > 112 && lat < 0) ? BIOMES.arid : BIOMES.savanna
  else if (a > 9) base = BIOMES.savanna
  else base = BIOMES.tropical
  // 5 tonos por bioma: permite agrupar países y pintar ~35 rellenos en vez de ~180
  const j = 0.88 + (Math.round(seed * 4) / 4) * 0.24
  return rgb(base.map((v) => clamp(v * j, 0, 255)))
}

// Avión con resplandor pre-renderizado (evita shadowBlur en cada cuadro)
const SPRITE_SCALE = 4
let planeSprite = null
function getPlaneSprite() {
  if (planeSprite) return planeSprite
  const size = 40 * SPRITE_SCALE
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  g.translate(size / 2, size / 2)
  g.scale(SPRITE_SCALE, SPRITE_SCALE)
  g.shadowColor = 'rgba(232, 180, 90, 0.9)'
  g.shadowBlur = 14 * SPRITE_SCALE
  g.fillStyle = C.ivory
  g.fill(PLANE)
  g.shadowBlur = 0
  g.strokeStyle = 'rgba(8, 29, 44, 0.65)'
  g.lineWidth = 0.8
  g.stroke(PLANE)
  planeSprite = c
  return c
}

function subsolar(date = new Date()) {
  const doy = (date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10))
  const h = date.getUTCHours() + date.getUTCMinutes() / 60
  return [(12 - h) * 15, decl]
}

function buildLayer(topo) {
  const obj = topo.objects.countries
  const countries = feature(topo, obj).features
  for (const f of countries) {
    const [lon, lat] = geoCentroid(f)
    f.fill = biomeColor(lon, lat, hash(String(f.id ?? f.properties.name)))
  }
  const byFill = new Map()
  for (const f of countries) {
    if (!byFill.has(f.fill)) byFill.set(f.fill, { type: 'FeatureCollection', features: [] })
    byFill.get(f.fill).features.push(f)
  }
  return {
    countries,
    groups: [...byFill].map(([fill, fc]) => ({ fill, fc })),
    borders: mesh(topo, obj, (a, b) => a !== b),
    coast: mesh(topo, obj, (a, b) => a === b),
  }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export class EarthMap {
  constructor(canvas, opts = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.base = document.createElement('canvas')
    this.bctx = this.base.getContext('2d')
    this.opts = { interactive: true, autoRotate: 0, detail: 'high', labels: 'full', ...opts }

    this.view = 'globe'
    this.rot = [75, -12]
    this.zoom = 1
    this.panY = 0
    this.routes = []
    this.active = { from: null, to: null }
    this.hoverCountry = null
    this.hoverHub = null
    this.hubScreen = []
    this.dirty = true
    this.interacting = false
    this.visible = true
    this.time = 0
    this.graticule = geoGraticule10()
    this.night = null
    this.lo = null
    this.hi = null

    this.resize = this.resize.bind(this)
    this.frame = this.frame.bind(this)
    new ResizeObserver(this.resize).observe(canvas)
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting
      if (this.visible) this.kick()
    }).observe(canvas)
    document.addEventListener('visibilitychange', () => !document.hidden && this.kick())
    if (this.opts.interactive) this.bindPointer()
    this.resize()
  }

  async load() {
    const lo = await fetch(atlasLoUrl).then((r) => r.json())
    this.lo = buildLayer(lo)
    this.updateNight()
    this.dirty = true
    this.kick()
    if (this.opts.detail === 'high') {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400))
      idle(async () => {
        try {
          const hi = await fetch(atlasHiUrl).then((r) => r.json())
          this.hi = buildLayer(hi)
          this.dirty = true
        } catch {
          /* se queda con la versión ligera */
        }
      })
    }
  }

  // ---------- geometría ----------
  resize() {
    const r = this.canvas.getBoundingClientRect()
    const coarse = window.matchMedia('(pointer: coarse)').matches
    this.dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr || (coarse ? 1.5 : 2))
    this.w = Math.max(1, Math.round(r.width))
    this.h = Math.max(1, Math.round(r.height))
    for (const c of [this.canvas, this.base]) {
      c.width = this.w * this.dpr
      c.height = this.h * this.dpr
    }
    this.dirty = true
    this.kick()
  }

  radius() {
    return Math.min(this.w, this.h) * 0.41 * this.zoom
  }

  projection() {
    if (this.view === 'globe') {
      return geoOrthographic()
        .translate([this.w / 2, this.h / 2])
        .scale(this.radius())
        .rotate(this.rot)
        .clipAngle(90)
        .precision(0.6)
    }
    const s = Math.min(this.w / 5.3, this.h / 2.6) * this.zoom
    const maxPan = Math.max(0, s * 1.45 - this.h * 0.2)
    this.panY = clamp(this.panY, -maxPan, maxPan)
    return geoNaturalEarth1()
      .rotate([this.rot[0], 0])
      .scale(s)
      .translate([this.w / 2, this.h / 2 + this.panY])
      .precision(0.6)
  }

  center() {
    return [-this.rot[0], this.view === 'globe' ? -this.rot[1] : 0]
  }

  isFront(coords) {
    return this.view !== 'globe' || geoDistance(coords, this.center()) < Math.PI / 2 - 0.03
  }

  // Proyección con altitud (para los arcos y los aviones)
  lifted(proj, coords, alt) {
    if (this.view === 'globe') {
      const [l, p] = geoRotation(this.rot)(coords)
      const lr = (l * Math.PI) / 180
      const pr = (p * Math.PI) / 180
      const X = Math.cos(pr) * Math.sin(lr)
      const Y = -Math.sin(pr)
      const Z = Math.cos(pr) * Math.cos(lr)
      const k = 1 + alt
      const R = this.radius()
      return { x: this.w / 2 + X * R * k, y: this.h / 2 + Y * R * k, vis: Z > 0 || Math.hypot(X, Y) * k > 1 }
    }
    const pt = proj(coords)
    return { x: pt[0], y: pt[1] - alt * proj.scale() * 0.35, vis: true }
  }

  updateNight() {
    const s = subsolar()
    const anti = [s[0] + 180, -s[1]]
    this.night = [92, 90, 88, 85].map((r) => geoCircle().center(anti).radius(r)())
  }

  // ---------- rutas ----------
  setRoutes(list) {
    this.routes = list.map((r, i) => {
      const a = HUBS[r.from].coords
      const b = HUBS[r.to].coords
      const d = geoDistance(a, b)
      return {
        ...r,
        a,
        b,
        d,
        interp: geoInterpolate(a, b),
        h: Math.min(0.17, 0.035 + d * 0.22),
        dur: 4.5 + d * 7,
        t: r.t ?? (list.length > 1 ? (i * 0.37) % 1 : 0),
        hold: 0,
        turbo: false,
      }
    })
    this.kick()
  }

  setActive(from, to, { turbo = false, focus = true } = {}) {
    this.active = { from, to }
    this.setRoutes([{ from, to, t: 0 }])
    if (turbo) this.routes[0].turbo = true
    if (focus) this.focusRoute()
  }

  focusRoute(duration = 1.4) {
    const r = this.routes[0]
    if (!r) return
    const mid = r.interp(0.5)
    const z = this.view === 'globe' ? clamp(1.65 - r.d * 0.75, 0.95, 1.5) : clamp(2.6 - r.d * 1.2, 1.2, 2.6)
    this.flyTo(mid, z, duration)
  }

  flyTo([lon, lat], zoom = this.zoom, duration = 1.4) {
    gsap.killTweensOf(this)
    const target0 = -lon
    const d0 = ((target0 - this.rot[0] + 540) % 360) - 180
    const st = { r0: this.rot[0], r1: this.rot[1], z: this.zoom, py: this.panY }
    const s = this.view === 'globe' ? 0 : Math.min(this.w / 5.3, this.h / 2.6) * zoom
    const pyTarget = this.view === 'globe' ? 0 : (lat * Math.PI) / 180 * s * 0.95
    this.interacting = true
    gsap.to(st, {
      r0: this.rot[0] + d0,
      r1: clamp(-lat * 0.9, -60, 60),
      z: zoom,
      py: pyTarget,
      duration: reducedMotion() ? 0 : duration,
      ease: 'power3.inOut',
      onUpdate: () => {
        this.rot = [st.r0, st.r1]
        this.zoom = st.z
        this.panY = st.py
        this.dirty = true
        this.kick()
      },
      onComplete: () => {
        this.interacting = false
        this.dirty = true
      },
    })
  }

  zoomBy(f) {
    const min = this.view === 'globe' ? 0.75 : 1
    gsap.to(this, {
      zoom: clamp(this.zoom * f, min, 7),
      duration: 0.45,
      ease: 'power2.out',
      onUpdate: () => {
        this.dirty = true
        this.kick()
      },
    })
  }

  setView(view) {
    if (view === this.view) return
    gsap.to(this.canvas, {
      opacity: 0,
      duration: 0.22,
      onComplete: () => {
        this.view = view
        this.zoom = 1
        this.panY = 0
        this.dirty = true
        this.focusRoute(0.01)
        gsap.to(this.canvas, { opacity: 1, duration: 0.45, ease: 'power2.out' })
      },
    })
  }

  // ---------- interacción ----------
  bindPointer() {
    const el = this.canvas
    const pts = new Map()
    let start = null
    let pinch = null

    const local = (e) => {
      const r = el.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, local(e))
      gsap.killTweensOf(this)
      if (pts.size === 1) {
        start = { p: local(e), rot: [...this.rot], panY: this.panY, moved: 0 }
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.zoom }
      }
    })

    el.addEventListener('pointermove', (e) => {
      const p = local(e)
      if (!pts.has(e.pointerId)) {
        // detección de país como mucho una vez por cuadro
        if (!this.hoverPending) requestAnimationFrame(() => {
          this.hover(this.hoverPending)
          this.hoverPending = null
        })
        this.hoverPending = p
        return
      }
      pts.set(e.pointerId, p)
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a[0] - b[0], a[1] - b[1])
        this.zoom = clamp((pinch.z * d) / pinch.d, this.view === 'globe' ? 0.75 : 1, 7)
        this.dirty = true
        return this.kick()
      }
      if (!start) return
      const dx = p[0] - start.p[0]
      const dy = p[1] - start.p[1]
      start.moved = Math.max(start.moved, Math.hypot(dx, dy))
      if (start.moved < 3) return
      this.interacting = true
      el.classList.add('is-dragging')
      if (this.view === 'globe') {
        const k = 180 / Math.PI / this.radius()
        this.rot = [start.rot[0] + dx * k, clamp(start.rot[1] - dy * k, -85, 85)]
      } else {
        const s = Math.min(this.w / 5.3, this.h / 2.6) * this.zoom
        this.rot = [start.rot[0] + (dx * 180) / (Math.PI * s * 0.87), 0]
        this.panY = start.panY + dy
      }
      this.hideTooltip()
      this.dirty = true
      this.kick()
    })

    const end = (e) => {
      const p = local(e)
      const wasClick = start && start.moved < 5 && pts.size === 1
      pts.delete(e.pointerId)
      if (pts.size < 2) pinch = null
      if (pts.size === 0) {
        if (wasClick) {
          const hub = this.hubAt(p)
          if (hub && this.opts.onHubClick) this.opts.onHubClick(hub)
        }
        start = null
        this.interacting = false
        el.classList.remove('is-dragging')
        this.dirty = true
        this.kick()
      }
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('pointerleave', () => {
      if (!pts.size) {
        this.hoverCountry = null
        this.hoverHub = null
        this.hideTooltip()
      }
    })

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        gsap.killTweensOf(this)
        this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0014), this.view === 'globe' ? 0.75 : 1, 7)
        this.dirty = true
        this.kick()
      },
      { passive: false },
    )
  }

  hubAt([x, y]) {
    let best = null
    let bd = 18
    for (const h of this.hubScreen) {
      const d = Math.hypot(h.x - x, h.y - y)
      if (d < bd) {
        bd = d
        best = h.city
      }
    }
    return best
  }

  hover(p) {
    if (!this.lo) return
    const hub = this.hubAt(p)
    this.hoverHub = hub
    this.canvas.style.cursor = hub ? 'pointer' : 'grab'
    if (hub) {
      this.hoverCountry = null
      const h = HUBS[hub]
      return this.showTooltip(p, `<strong>${hub}</strong><span>${h.code} · ${h.country}</span><em>Toca para fijar destino</em>`)
    }
    const geo = this.proj?.invert?.(p)
    let found = null
    if (geo && !Number.isNaN(geo[0]) && this.isFront(geo)) {
      found = this.lo.countries.find((f) => geoContains(f, geo)) || null
      // Resalta con la geometría detallada si ya cargó
      if (found && this.hi && found.id != null) found = this.hi.countries.find((f) => f.id === found.id) || found
    }
    if (found?.id !== this.hoverCountry?.id) this.hoverCountry = found
    if (found) this.showTooltip(p, `<strong>${found.properties.name}</strong>`)
    else this.hideTooltip()
  }

  showTooltip([x, y], html) {
    const tip = this.opts.tooltip
    if (!tip) return
    tip.innerHTML = html
    tip.hidden = false
    tip.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 14)}px)`
  }

  hideTooltip() {
    if (this.opts.tooltip) this.opts.tooltip.hidden = true
  }

  // ---------- render ----------
  kick() {
    if (!this.raf && this.visible && !document.hidden) {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  frame(now) {
    this.raf = null
    // Límite de FPS opcional (el globo decorativo no necesita 60/120 fps)
    if (this.opts.maxFps && now - this.last < 1000 / this.opts.maxFps - 3) {
      this.raf = requestAnimationFrame(this.frame)
      return
    }
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.time += dt

    if (this.opts.autoRotate && !reducedMotion() && !this.interacting) {
      this.rot = [this.rot[0] + this.opts.autoRotate * dt, this.rot[1]]
      this.dirty = true
    }

    for (const r of this.routes) {
      if (r.hold > 0) {
        r.hold -= dt
        if (r.hold <= 0) {
          r.t = 0
          r.turbo = false
        }
        continue
      }
      r.t += dt / (r.turbo ? r.dur * 0.55 : r.dur)
      if (r.t >= 1) {
        r.t = 1
        r.hold = 1.1
      }
    }

    if (this.lo) {
      this.proj = this.projection()
      if (this.dirty) this.drawBase()
      this.drawOverlay()
      if (this.opts.onFrame && this.routes[0]) {
        const r = this.routes[0]
        this.opts.onFrame({ t: r.t, alt: Math.sin(Math.PI * r.t), holding: r.hold > 0 })
      }
    }

    if (this.visible && !document.hidden) this.kick()
  }

  drawBase() {
    this.dirty = false
    const ctx = this.bctx
    const dpr = this.dpr
    const { w, h } = this
    const proj = this.proj
    const layer = this.hi && !this.interacting && !this.opts.autoRotate ? this.hi : this.lo
    const path = geoPath(proj, ctx)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const globe = this.view === 'globe'
    const R = this.radius()
    const cx = w / 2
    const cy = h / 2

    if (globe) {
      // Atmósfera
      const atm = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.17)
      atm.addColorStop(0, 'rgba(140, 214, 232, 0.42)')
      atm.addColorStop(0.35, 'rgba(98, 180, 214, 0.14)')
      atm.addColorStop(1, 'rgba(60, 140, 190, 0)')
      ctx.fillStyle = atm
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.17, 0, Math.PI * 2)
      ctx.fill()
      // Océano
      const sea = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R)
      sea.addColorStop(0, '#22708a')
      sea.addColorStop(0.5, '#123f59')
      sea.addColorStop(1, '#081d2c')
      ctx.fillStyle = sea
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      path({ type: 'Sphere' })
      const sea = ctx.createLinearGradient(0, proj([0, 85])[1], 0, proj([0, -85])[1])
      sea.addColorStop(0, '#0b2a3d')
      sea.addColorStop(0.5, '#155070')
      sea.addColorStop(1, '#0b2a3d')
      ctx.fillStyle = sea
      ctx.fill()
    }

    // Retícula
    ctx.beginPath()
    path(this.graticule)
    ctx.strokeStyle = C.graticule
    ctx.lineWidth = 0.6
    ctx.stroke()

    // Países (bioma)
    for (const g of layer.groups) {
      ctx.beginPath()
      path(g.fc)
      ctx.fillStyle = g.fill
      ctx.fill()
    }
    ctx.beginPath()
    path(layer.borders)
    ctx.strokeStyle = C.border
    ctx.lineWidth = 0.5
    ctx.stroke()
    ctx.beginPath()
    path(layer.coast)
    ctx.strokeStyle = C.coast
    ctx.lineWidth = 0.7
    ctx.stroke()

    // Lado nocturno (hora real)
    if (this.night) {
      ctx.fillStyle = 'rgba(2, 9, 18, 0.13)'
      for (const n of this.night) {
        ctx.beginPath()
        path(n)
        ctx.fill()
      }
    }

    if (globe) {
      // Oscurecimiento de borde + brillo especular: volumen
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.clip()
      const limb = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.2, cx, cy, R * 1.02)
      limb.addColorStop(0, 'rgba(0,0,0,0)')
      limb.addColorStop(0.62, 'rgba(2,8,14,0.08)')
      limb.addColorStop(1, 'rgba(2,8,14,0.62)')
      ctx.fillStyle = limb
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
      const spec = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, 0, cx - R * 0.38, cy - R * 0.42, R * 0.7)
      spec.addColorStop(0, 'rgba(255, 238, 210, 0.16)')
      spec.addColorStop(1, 'rgba(255, 238, 210, 0)')
      ctx.fillStyle = spec
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
      ctx.restore()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(170, 225, 238, 0.35)'
      ctx.lineWidth = 1.2
      ctx.stroke()
    } else {
      const vig = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.75)
      vig.addColorStop(0, 'rgba(0,0,0,0)')
      vig.addColorStop(1, 'rgba(3,10,18,0.55)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, w, h)
    }
  }

  drawOverlay() {
    const ctx = this.ctx
    const dpr = this.dpr
    const proj = this.proj
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.drawImage(this.base, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // País bajo el cursor
    if (this.hoverCountry) {
      const path = geoPath(proj, ctx)
      ctx.beginPath()
      path(this.hoverCountry)
      ctx.fillStyle = 'rgba(243, 238, 228, 0.16)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(243, 238, 228, 0.7)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    for (const r of this.routes) this.drawRoute(r)
    this.drawHubs()
  }

  routePoints(r, t0, t1, n) {
    const out = []
    for (let i = 0; i <= n; i++) {
      const s = t0 + ((t1 - t0) * i) / n
      out.push(this.lifted(this.proj, r.interp(s), r.h * Math.sin(Math.PI * s)))
    }
    return out
  }

  strokeSegments(pts) {
    const ctx = this.ctx
    ctx.beginPath()
    let pen = false
    for (const p of pts) {
      if (!p.vis) {
        pen = false
        continue
      }
      if (pen) ctx.lineTo(p.x, p.y)
      else ctx.moveTo(p.x, p.y)
      pen = true
    }
    ctx.stroke()
  }

  drawRoute(r) {
    const ctx = this.ctx
    const single = this.routes.length === 1
    const all = this.routePoints(r, 0, 1, 80)

    // Trazado completo (punteado)
    ctx.save()
    ctx.setLineDash([3, 6])
    ctx.lineDashOffset = -this.time * 14
    ctx.strokeStyle = single ? 'rgba(243, 238, 228, 0.45)' : 'rgba(243, 238, 228, 0.22)'
    ctx.lineWidth = 1.1
    this.strokeSegments(all)
    ctx.restore()

    // Tramo recorrido
    if (r.t > 0.001) {
      const done = this.routePoints(r, 0, r.t, Math.max(2, Math.round(80 * r.t)))
      const a = done[0]
      const b = done[done.length - 1]
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
      g.addColorStop(0, single ? C.origin : 'rgba(232,180,90,0.5)')
      g.addColorStop(1, single ? C.dest : 'rgba(98,205,194,0.8)')
      ctx.save()
      ctx.lineCap = 'round'
      // halo: trazo ancho translúcido en lugar de shadowBlur
      ctx.strokeStyle = 'rgba(232, 180, 90, 0.16)'
      ctx.lineWidth = single ? 9 : 5
      this.strokeSegments(done)
      ctx.strokeStyle = g
      ctx.lineWidth = single ? 2.4 : 1.5
      this.strokeSegments(done)
      ctx.restore()
    }

    // Avión
    const t = clamp(r.t, 0, 0.999)
    const alt = r.h * Math.sin(Math.PI * t)
    const here = this.lifted(this.proj, r.interp(t), alt)
    if (!here.vis) return
    const ahead = this.lifted(this.proj, r.interp(Math.min(1, t + 0.01)), r.h * Math.sin(Math.PI * Math.min(1, t + 0.01)))
    const ang = Math.atan2(ahead.y - here.y, ahead.x - here.x)
    const ground = this.lifted(this.proj, r.interp(t), 0)
    const lift = Math.sin(Math.PI * t)
    const size = (single ? 1.15 : 0.75) * (0.85 + lift * 0.35) * clamp(this.zoom, 0.8, 1.6)

    // Sombra sobre la superficie
    if (ground.vis && this.isFront(r.interp(t))) {
      ctx.save()
      ctx.translate(ground.x, ground.y)
      ctx.rotate(ang)
      ctx.scale(size * 0.8, size * 0.8)
      ctx.globalAlpha = 0.28 * (1 - lift * 0.5)
      ctx.fillStyle = '#02080e'
      ctx.fill(PLANE)
      ctx.restore()
    }

    // Estela
    const trail = this.routePoints(r, Math.max(0, t - 0.08), t, 10)
    ctx.save()
    ctx.lineCap = 'round'
    for (let i = 1; i < trail.length; i++) {
      if (!trail[i].vis || !trail[i - 1].vis) continue
      ctx.strokeStyle = `rgba(243, 238, 228, ${(i / trail.length) * 0.55})`
      ctx.lineWidth = (i / trail.length) * 2.4 * size
      ctx.beginPath()
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y)
      ctx.lineTo(trail[i].x, trail[i].y)
      ctx.stroke()
    }
    ctx.restore()

    const sprite = getPlaneSprite()
    const half = sprite.width / SPRITE_SCALE / 2
    ctx.save()
    ctx.translate(here.x, here.y)
    ctx.rotate(ang)
    ctx.scale(size, size)
    ctx.drawImage(sprite, -half, -half, half * 2, half * 2)
    ctx.restore()
  }

  drawHubs() {
    const ctx = this.ctx
    const full = this.opts.labels === 'full'
    this.hubScreen = []
    for (const city of CITY_LIST) {
      const coords = HUBS[city].coords
      if (!this.isFront(coords)) continue
      const p = this.proj(coords)
      if (!p) continue
      const [x, y] = p
      this.hubScreen.push({ city, x, y })
      const isO = city === this.active.from
      const isD = city === this.active.to
      const col = isO ? C.origin : isD ? C.dest : C.ivory
      const hot = isO || isD || city === this.hoverHub

      if (hot) {
        const ph = (this.time * 0.7 + (isD ? 0.5 : 0)) % 1
        ctx.beginPath()
        ctx.arc(x, y, 5 + ph * 16, 0, Math.PI * 2)
        ctx.strokeStyle = isO ? `rgba(232,180,90,${1 - ph})` : isD ? `rgba(98,205,194,${1 - ph})` : `rgba(243,238,228,${1 - ph})`
        ctx.lineWidth = 1.2
        ctx.stroke()
      }
      const glow = ctx.createRadialGradient(x, y, 0, x, y, hot ? 14 : 9)
      glow.addColorStop(0, isO ? 'rgba(232,180,90,0.55)' : isD ? 'rgba(98,205,194,0.55)' : 'rgba(243,238,228,0.35)')
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, hot ? 14 : 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, y, hot ? 3.6 : 2.6, 0, Math.PI * 2)
      ctx.fillStyle = col
      ctx.fill()
      ctx.strokeStyle = 'rgba(6, 18, 28, 0.9)'
      ctx.lineWidth = 1
      ctx.stroke()

      // Etiquetas (evita solapar Bogotá/Medellín)
      const left = city === 'Medellín' || city === 'Toronto' || city === 'México'
      const label = full ? city.toUpperCase() : HUBS[city].code
      ctx.font = `${hot ? 600 : 500} ${hot ? 11.5 : 10.5}px "JetBrains Mono", ui-monospace, monospace`
      ctx.textAlign = left ? 'right' : 'left'
      ctx.textBaseline = 'middle'
      const tx = x + (left ? -10 : 10)
      const ty = y + (city === 'Medellín' ? -6 : city === 'Bogotá' ? 6 : 0)
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(6, 18, 28, 0.85)'
      ctx.strokeText(label, tx, ty)
      ctx.fillStyle = hot ? col : 'rgba(243, 238, 228, 0.82)'
      ctx.fillText(label, tx, ty)
    }
  }
}
