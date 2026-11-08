// A steel W-beam highway guardrail, built in three.js from its real cross-section.
// One post per month of runway: the rail runs as far as the customer's savings last,
// and the months bought by guardrails are added as Tangerine-orange rail.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const MONTH = 2.0 // metres of road per month (post spacing)
const MAX_MONTHS = 12
const RAIL_Y = 0.55 // centre height of the beam
const BEAM_H = 0.31 // W-beam is 312 mm tall
const BEAM_D = 0.083 // and 83 mm deep
const THK = 0.006
const PRE = -9 // the rail behind today, entering from the frame edge

const C = {
  sky: 0xe6e9ea,
  asphalt: 0x2b2f33,
  shoulder: 0x6d7276,
  grass: 0x3f5a48,
  paint: 0xefefed,
  orange: 0xef6a1a,
  postSteel: 0x9aa2a8,
}

// ---------- textures drawn on canvas ----------
function noiseCanvas(size, base, spread, dots, seed = 1) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  g.fillStyle = `rgb(${base},${base},${base})`
  g.fillRect(0, 0, size, size)
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < dots; i++) {
    const v = Math.round(base + (rnd() - 0.5) * spread)
    g.fillStyle = `rgb(${v},${v},${v})`
    const r = rnd() * 2 + 0.4
    g.fillRect(rnd() * size, rnd() * size, r, r)
  }
  return c
}

// Galvanized spangle: soft crystalline blotches that vary the roughness.
function spangleCanvas() {
  const size = 512
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  g.fillStyle = 'rgb(110,110,110)'
  g.fillRect(0, 0, size, size)
  let s = 7
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 900; i++) {
    const v = Math.round(70 + rnd() * 90)
    g.fillStyle = `rgba(${v},${v},${v},0.55)`
    g.beginPath()
    const x = rnd() * size
    const y = rnd() * size
    const r = 6 + rnd() * 22
    const n = 5 + Math.floor(rnd() * 3)
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rnd() * 0.5
      const rr = r * (0.6 + rnd() * 0.5)
      k ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    g.fill()
  }
  return c
}

function numeralTexture(text, color = '#efefed') {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = color
  g.font = '700 200px "Arial Narrow", Arial, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 128, 138)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

// ---------- the W-beam, swept along a path ----------
// Profile: depth toward the road as a function of height. Two crowns, one valley.
const NP = 56
const PROFILE = (() => {
  const pts = []
  for (let i = 0; i <= NP; i++) {
    const t = i / NP
    // each half: slope up, flat crown, slope down (smoothstepped), like the rolled steel section
    const h = (t * 2) % 1
    const ss = (a, b, x) => {
      const k = Math.min(Math.max((x - a) / (b - a), 0), 1)
      return k * k * (3 - 2 * k)
    }
    const w = ss(0.06, 0.36, h) * (1 - ss(0.64, 0.94, h))
    let d = BEAM_D * w
    // edges roll back a little, like the real return flanges
    if (t < 0.04) d -= (0.04 - t) * 0.35
    if (t > 0.96) d -= (t - 0.96) * 0.35
    pts.push({ y: -BEAM_H / 2 + t * BEAM_H, d })
  }
  // normals in the (depth, height) plane
  return pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)]
    const b = pts[Math.min(i + 1, NP)]
    const ty = b.y - a.y
    const td = b.d - a.d
    const len = Math.hypot(ty, td)
    return { ...p, nd: ty / len, ny: -td / len }
  })
})()

// path: [{x, z, tx, tz}] with tangent; the road side is N = (-tz, tx).
function sweepBeam(path) {
  const pos = []
  const nor = []
  const uv = []
  const idx = []
  let u = 0
  const ring = (P, side) => {
    const Nx = -P.tz
    const Nz = P.tx
    for (const q of PROFILE) {
      const off = side ? -THK : 0
      const dd = q.d + off * q.nd
      const yy = q.y + off * q.ny
      pos.push(P.x + Nx * dd, RAIL_Y + yy, P.z + Nz * dd)
      const s = side ? -1 : 1
      nor.push(Nx * q.nd * s, q.ny * s, Nz * q.nd * s)
      uv.push(u, (q.y + BEAM_H / 2) / BEAM_H)
    }
  }
  const per = NP + 1
  for (let side = 0; side < 2; side++) {
    const base = pos.length / 3
    u = 0
    path.forEach((P, i) => {
      if (i) u += Math.hypot(P.x - path[i - 1].x, P.z - path[i - 1].z) / 1.2
      ring(P, side)
    })
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = 0; j < NP; j++) {
        const a = base + i * per + j
        const b = a + per
        if (side === 0) idx.push(a, b, a + 1, b, b + 1, a + 1)
        else idx.push(a, a + 1, b, b, a + 1, b + 1)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

function straight(x0, x1) {
  return [
    { x: x0, z: 0, tx: 1, tz: 0 },
    { x: x1, z: 0, tx: 1, tz: 0 },
  ]
}

// Rounded end: the beam curls back away from the road.
function endCurl(x0, R = 0.32, steps = 14) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI * 0.62)
    pts.push({ x: x0 + R * Math.sin(a), z: -R + R * Math.cos(a), tx: Math.cos(a), tz: -Math.sin(a) })
  }
  return pts
}

// ---------- posts, blockouts, bolts ----------
function iBeamGeometry() {
  const w = 0.1
  const d = 0.15
  const f = 0.009
  const web = 0.006
  const s = new THREE.Shape()
  s.moveTo(-w / 2, -d / 2)
  s.lineTo(w / 2, -d / 2)
  s.lineTo(w / 2, -d / 2 + f)
  s.lineTo(web / 2, -d / 2 + f)
  s.lineTo(web / 2, d / 2 - f)
  s.lineTo(w / 2, d / 2 - f)
  s.lineTo(w / 2, d / 2)
  s.lineTo(-w / 2, d / 2)
  s.lineTo(-w / 2, d / 2 - f)
  s.lineTo(-web / 2, d / 2 - f)
  s.lineTo(-web / 2, -d / 2 + f)
  s.lineTo(-w / 2, -d / 2 + f)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.05, bevelEnabled: false })
  g.rotateX(-Math.PI / 2) // extrude upward
  g.translate(0, -0.3, 0)
  return g
}

export function createRailScene(canvas, { onFrame, keys, fogOut = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 0.95
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(C.sky)
  scene.fog = new THREE.Fog(C.sky, 12, 40)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = envTex
  scene.environmentIntensity = 0.9

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120)

  // light
  scene.add(new THREE.HemisphereLight(0xf4f6f7, 0x2b2f33, 0.9))
  const sun = new THREE.DirectionalLight(0xfff6ea, 2.6)
  sun.position.set(-4, 9, 7)
  sun.target.position.set(8, 0, 0)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 10, bottom: -10, near: 1, far: 40 })
  sun.shadow.camera.position.set(-4, 9, 7)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.02
  scene.add(sun, sun.target)

  // materials
  const spangle = new THREE.CanvasTexture(spangleCanvas())
  spangle.wrapS = spangle.wrapT = THREE.RepeatWrapping
  spangle.repeat.set(1, 1)
  const steel = new THREE.MeshStandardMaterial({
    color: 0xc9cfd3,
    metalness: 0.92,
    roughness: 0.42,
    roughnessMap: spangle,
    side: THREE.DoubleSide,
  })
  const orangeSteel = new THREE.MeshStandardMaterial({
    color: C.orange, // powder-coated Tangerine orange
    metalness: 0.15,
    roughness: 0.45,
    side: THREE.DoubleSide,
  })
  const postMat = new THREE.MeshStandardMaterial({ color: C.postSteel, metalness: 0.8, roughness: 0.55 })
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x6b6f72, metalness: 0.5, roughness: 0.6 })
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x5c6166, metalness: 0.9, roughness: 0.35 })

  const asphaltTex = new THREE.CanvasTexture(noiseCanvas(512, 52, 60, 26000, 3))
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping
  asphaltTex.repeat.set(30, 6)
  asphaltTex.colorSpace = THREE.SRGBColorSpace
  const asphalt = new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTex, roughness: 0.95, metalness: 0 })
  const gravelTex = new THREE.CanvasTexture(noiseCanvas(256, 120, 90, 14000, 5))
  gravelTex.wrapS = gravelTex.wrapT = THREE.RepeatWrapping
  gravelTex.repeat.set(60, 1)
  gravelTex.colorSpace = THREE.SRGBColorSpace
  const gravel = new THREE.MeshStandardMaterial({ color: 0xb9bdbf, map: gravelTex, roughness: 1 })
  const grass = new THREE.MeshStandardMaterial({ color: C.grass, roughness: 1 })
  const paint = new THREE.MeshStandardMaterial({ color: C.paint, roughness: 0.7 })
  const orangePaint = new THREE.MeshStandardMaterial({ color: C.orange, roughness: 0.7 })

  // ground: road on the near side (+z), the embankment drops away behind the rail
  const plane = (w, h, mat, x, y, z, rx = -Math.PI / 2) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
    m.rotation.x = rx
    m.position.set(x, y, z)
    m.receiveShadow = true
    scene.add(m)
    return m
  }
  plane(90, 14, asphalt, 20, 0, 7.6)
  plane(90, 0.95, gravel, 20, 0.001, 0.2)
  plane(90, 0.16, paint, 20, 0.004, 1.0) // solid edge line
  for (let x = -20; x < 70; x += 9) plane(3, 0.14, paint, x, 0.004, 4.9) // lane dashes
  plane(90, 30, grass, 20, -0.002, -15.2)

  // painted month numbers on the shoulder lane, readable to a driver heading down the road
  const numerals = []
  for (let m = 1; m <= MAX_MONTHS; m++) {
    const mat = new THREE.MeshStandardMaterial({
      map: numeralTexture(String(m), m === 6 ? '#ef6a1a' : '#efefed'),
      transparent: true,
      roughness: 0.8,
      depthWrite: false,
    })
    const n = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), mat)
    n.rotation.x = -Math.PI / 2
    n.rotation.z = -Math.PI / 2 // text "up" points down the road
    n.position.set(m * MONTH - 0.9, 0.006, 2.05)
    n.scale.set(1, 1.9, 1) // stretched along travel, like real road markings
    scene.add(n)
    numerals.push(n)
  }
  // the 6-month goal: an orange bar across the shoulder
  plane(0.16, 1.9, orangePaint, 6 * MONTH, 0.005, 1.0)

  // posts with blockouts, one per month
  const ibeam = iBeamGeometry()
  const blockGeo = new THREE.BoxGeometry(0.1, 0.36, 0.15)
  const boltGeo = new THREE.SphereGeometry(0.016, 12, 8)
  boltGeo.scale(1, 1, 0.45)
  const posts = []
  for (let m = Math.ceil(PRE / MONTH); m <= MAX_MONTHS + 1; m++) {
    const grp = new THREE.Group()
    const post = new THREE.Mesh(ibeam, postMat)
    post.position.z = -0.235
    const block = new THREE.Mesh(blockGeo, blockMat)
    block.position.set(0, RAIL_Y, -0.085)
    const bolt = new THREE.Mesh(boltGeo, boltMat)
    bolt.position.set(0, RAIL_Y, 0.0075)
    for (const o of [post, block, bolt]) {
      o.castShadow = true
      o.receiveShadow = true
      grp.add(o)
    }
    grp.position.x = m * MONTH
    grp.userData.month = m
    scene.add(grp)
    posts.push(grp)
  }

  // the beam itself: rebuilt whenever its length changes
  const steelMesh = new THREE.Mesh(new THREE.BufferGeometry(), steel)
  const orangeMesh = new THREE.Mesh(new THREE.BufferGeometry(), orangeSteel)
  const curlMesh = new THREE.Mesh(new THREE.BufferGeometry(), steel)
  for (const m of [steelMesh, orangeMesh, curlMesh]) {
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
  }

  let cur = { base: 0, extra: 0 }
  let target = { base: 0, extra: 0 }
  let speed = 3.2 // how fast the rail grows or shrinks toward its target
  let built = { base: -1, extra: -1 }

  function build() {
    const xb = Math.max(cur.base, 0.001) * MONTH
    const xe = xb + cur.extra * MONTH
    steelMesh.geometry.dispose()
    steelMesh.geometry = sweepBeam(straight(PRE, xb))
    orangeMesh.geometry.dispose()
    orangeMesh.visible = cur.extra > 0.002
    orangeMesh.geometry = orangeMesh.visible ? sweepBeam(straight(xb - 0.002, xe)) : new THREE.BufferGeometry()
    curlMesh.geometry.dispose()
    curlMesh.geometry = sweepBeam(endCurl(xe))
    curlMesh.material = orangeMesh.visible ? orangeSteel : steel
    const total = cur.base + cur.extra
    for (const p of posts) {
      const m = p.userData.month
      const vis = m <= 0 || m <= total + 0.08
      p.visible = vis
    }
    built = { ...cur }
  }

  // camera: a drive down the road, one keyframe per chapter (position, look-at point)
  const KEYS = keys ?? [
    { p: [-1.7, 0.95, 1.5], l: [10, 0.55, -0.9] },
    { p: [1.2, 0.85, 1.35], l: [12, 0.5, -0.8] },
    { p: [3.4, 1.05, 1.7], l: [9.5, 0.35, -0.6] },
    { p: [4.4, 1.05, 1.75], l: [15, 0.6, -0.7] },
    { p: [6.2, 1.0, 1.65], l: [16.5, 0.5, -0.8] },
    { p: [17.5, 1.3, 1.9], l: [32, 1.0, -0.6] },
  ]
  const look = new THREE.Vector3()
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 }
  let stage = 0 // target position along KEYS (0..KEYS.length-1)
  let stageS = 0 // smoothed
  const lerp = (a, b, k) => a + (b - a) * k
  function placeCamera() {
    stageS = Math.min(Math.max(stageS, 0), KEYS.length - 1)
    const i = Math.min(Math.floor(stageS), KEYS.length - 2)
    const f = stageS - i
    const k = f * f * (3 - 2 * f)
    const A = KEYS[i]
    const B = KEYS[i + 1]
    const px = pointer.sx
    const py = pointer.sy
    camera.position.set(lerp(A.p[0], B.p[0], k) + px * 0.25, lerp(A.p[1], B.p[1], k) + py * 0.1, lerp(A.p[2], B.p[2], k) - px * 0.1)
    look.set(lerp(A.l[0], B.l[0], k), lerp(A.l[1], B.l[1], k), lerp(A.l[2], B.l[2], k))
    camera.lookAt(look)
    // the last stretch drives into the fog
    const out = fogOut ? Math.max(stageS - (KEYS.length - 2), 0) : 0
    scene.fog.near = lerp(12, 2, out)
    scene.fog.far = lerp(40, 14, out)
  }

  let w = 1
  let h = 1
  function resize() {
    const r = canvas.getBoundingClientRect()
    w = Math.max(r.width, 1)
    h = Math.max(r.height, 1)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // narrow screens: widen the view so the rail still reaches the horizon
    camera.fov = w / h < 0.9 ? 52 : 30
    camera.updateProjectionMatrix()
  }

  const endV = new THREE.Vector3()
  function endScreen() {
    endV.set((cur.base + cur.extra) * MONTH + 0.15, RAIL_Y + 0.42, 0)
    endV.project(camera)
    return { x: (endV.x * 0.5 + 0.5) * w, y: (-endV.y * 0.5 + 0.5) * h }
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let raf = 0
  let running = false
  let last = performance.now()
  function frame(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05)
    last = now
    const k = reduce ? 1 : 1 - Math.exp(-dt * speed)
    cur.base += (target.base - cur.base) * k
    cur.extra += (target.extra - cur.extra) * k
    if (Math.abs(cur.base - built.base) > 0.0005 || Math.abs(cur.extra - built.extra) > 0.0005) build()
    stageS += (stage - stageS) * (reduce ? 1 : 1 - Math.exp(-dt * 4))
    const kp = reduce ? 0 : 1 - Math.exp(-dt * 2.5)
    pointer.sx += (pointer.x - pointer.sx) * kp
    pointer.sy += (pointer.y - pointer.sy) * kp
    placeCamera()
    renderer.render(scene, camera)
    onFrame?.({ end: endScreen(), months: cur.base + cur.extra })
    if (running) raf = requestAnimationFrame(frame)
  }

  return {
    setRunway(base, extra = 0, rate = 3.2) {
      speed = rate
      target = { base: Math.min(base, MAX_MONTHS), extra: Math.max(Math.min(base + extra, MAX_MONTHS) - Math.min(base, MAX_MONTHS), 0) }
    },
    jump() {
      cur = { ...target }
    },
    setPointer(x, y) {
      pointer.x = x
      pointer.y = y
    },
    setStage(t) {
      stage = Math.min(Math.max(t, 0), KEYS.length - 1)
    },
    stages: KEYS.length,
    resize,
    start() {
      if (running) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(frame)
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
    },
    dispose() {
      this.stop()
      scene.traverse((o) => {
        o.geometry?.dispose()
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
        mats.forEach((m) => {
          m.map?.dispose()
          m.dispose()
        })
      })
      envTex.dispose()
      pmrem.dispose()
      renderer.dispose()
    },
  }
}
