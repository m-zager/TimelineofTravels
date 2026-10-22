// The globe's land, drawn as dots that react to the pointer — adapted from the Particles demo.
// Move over the globe and the dots are pushed away from the pointer and spring home behind
// it; click and a shockwave throws the nearby dots out before they gather again.
//
// globe.gl handles the camera, clicks and markers (its sphere is invisible). The land dots are
// drawn here on a 2D canvas laid over it: each dot has a fixed home on the sphere, projected to the
// screen every frame with the globe's own camera, plus a spring offset in screen pixels. The
// physics are the demo's:
// - Frames, not milliseconds: `dt` is in sixtieths of a second and damping is raised to it,
//   so a dropped frame loses the same energy as the frames it replaced.
// - A moving dot is drawn stretched along its path, so a push reads as a splash.
// - Nothing is redrawn while the view is still and every dot has settled.

import { geoEquirectangular, geoPath, type GeoPermissibleObjects } from "d3-geo";
import type { GlobeInstance } from "globe.gl";

/** Points spread evenly over the whole sphere; the ones on land become dots (~29%). */
const SPHERE_POINTS = 32000;
/** Dot radius as a share of the globe's on-screen radius (about a third of the spacing). */
const DOT_SCALE = 0.0063;
/** Pointer push: how far it reaches (px) and how hard it pushes (the demo's force 30). Kept
    small so the land right under the pointer stays visible for picking a spot. */
const REACH = 24;
const PUSH = 0.3 * 11;
/** Click shockwave: how far it reaches (px) and its strength (the demo's at force 30). */
const WAVE_REACH = 80;
const WAVE = 30 * (0.4 + 0.3 * 1.2);
/** Resolution of the land lookup map. */
const MASK_W = 2048;
const MASK_H = 1024;

export type DottedLand = {
  /** Pointer position in viewport coordinates. */
  pointer(clientX: number, clientY: number): void;
  release(): void;
  shockwave(clientX: number, clientY: number): void;
  destroy(): void;
};

// Minimal shapes of the three.js objects read here (globe.gl doesn't type them in detail).
type Matrix = { elements: ArrayLike<number> };
type Camera = { projectionMatrix: Matrix; matrixWorldInverse: Matrix; position: { x: number; y: number; z: number }; fov: number };
type GlobeObject = { visible: boolean; matrixWorld: Matrix; getGlobeRadius(): number };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// Column-major 4×4 multiply (three.js layout): a × b.
function multiply(a: ArrayLike<number>, b: ArrayLike<number>, out: Float64Array) {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

// Unit vectors (in globe.gl's coordinates) for evenly spread points that fall on land.
function landDots(land: GeoPermissibleObjects) {
  const mask = document.createElement("canvas");
  mask.width = MASK_W;
  mask.height = MASK_H;
  const ctx = mask.getContext("2d", { willReadFrequently: true })!;
  // d3 cuts shapes at the antimeridian, so Russia, Fiji and Antarctica draw correctly.
  const projection = geoEquirectangular().scale(MASK_W / (2 * Math.PI)).translate([MASK_W / 2, MASK_H / 2]);
  ctx.beginPath();
  geoPath(projection, ctx)(land);
  ctx.fill();
  const alpha = ctx.getImageData(0, 0, MASK_W, MASK_H).data;

  const ux: number[] = [];
  const uy: number[] = [];
  const uz: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < SPHERE_POINTS; i++) {
    // Fibonacci sphere: equal-area spacing, no clumping at the poles.
    const sinLat = 1 - (2 * (i + 0.5)) / SPHERE_POINTS;
    const lat = (Math.asin(sinLat) * 180) / Math.PI;
    const lng = ((((i * golden) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * (180 / Math.PI) - 180;
    const px = Math.min(MASK_W - 1, Math.floor(((lng + 180) / 360) * MASK_W));
    const py = Math.min(MASK_H - 1, Math.floor(((90 - lat) / 180) * MASK_H));
    if (alpha[(py * MASK_W + px) * 4 + 3] < 128) continue;
    // Same convention as globe.gl's polar2Cartesian.
    const phi = ((90 - lat) * Math.PI) / 180;
    const theta = ((90 - lng) * Math.PI) / 180;
    ux.push(Math.sin(phi) * Math.cos(theta));
    uy.push(Math.cos(phi));
    uz.push(Math.sin(phi) * Math.sin(theta));
  }
  return { ux: Float32Array.from(ux), uy: Float32Array.from(uy), uz: Float32Array.from(uz) };
}

export function createDottedLand(
  globe: GlobeInstance,
  land: GeoPermissibleObjects,
  { color, outline, still }: { color: string; outline: string; still: boolean },
): DottedLand {
  const { ux, uy, uz } = landDots(land);
  const n = ux.length;
  // Screen position of each dot's home, whether it faces the camera, and how squarely.
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const facing = new Float32Array(n);
  // Spring offset from home, in screen px, and its velocity.
  const ox = new Float32Array(n);
  const oy = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);

  const renderer = globe.renderer() as unknown as { domElement: HTMLCanvasElement };
  const canvas = document.createElement("canvas");
  canvas.className = "dotted-land";
  canvas.setAttribute("aria-hidden", "true");
  // Above the WebGL sphere, below globe.gl's HTML markers (which come after it).
  renderer.domElement.after(canvas);
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  let hand: { x: number; y: number } | null = null;
  let handMoved = false;
  let active = 0;
  let raf = 0;
  let prev = 0;
  let inView = true;
  let lastView = "";
  const mvp = new Float64Array(16);
  const pv = new Float64Array(16);

  function findGlobeObject(): GlobeObject | undefined {
    const scene = globe.scene() as unknown as { children: unknown[] };
    return scene.children.find((child) => typeof (child as GlobeObject).getGlobeRadius === "function") as
      | GlobeObject
      | undefined;
  }

  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    const dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1;
    prev = t;

    const width = canvas.parentElement?.clientWidth ?? 0;
    const height = canvas.parentElement?.clientHeight ?? 0;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      lastView = "";
    }

    const globeObject = findGlobeObject();
    if (!globeObject?.visible || !width) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      lastView = "";
      return;
    }

    // Where the globe is and how it's seen. The globe object is scaled and spun by
    // globe.gl's intro animation, so its own transform is part of the projection.
    const camera = globe.camera() as unknown as Camera;
    const m = globeObject.matrixWorld.elements;
    multiply(camera.projectionMatrix.elements, camera.matrixWorldInverse.elements, pv);
    multiply(pv, m, mvp);
    const view = Array.prototype.join.call(mvp, ",") + `|${width}x${height}`;
    const viewChanged = view !== lastView;
    lastView = view;

    // Skip the frame entirely when nothing on screen could have changed.
    if (!viewChanged && !active && !handMoved) return;
    handMoved = false;

    const scale = Math.hypot(m[0], m[1], m[2]);
    const radius = globeObject.getGlobeRadius();
    const cx = camera.position.x - m[12];
    const cy = camera.position.y - m[13];
    const cz = camera.position.z - m[14];
    const distance = Math.hypot(cx, cy, cz);
    // A point on a sphere is visible when its normal leans toward the camera by more than
    // radius / distance (the cosine of the horizon angle).
    const horizon = (radius * scale) / distance;
    const screenRadius = (height / 2 / Math.tan((camera.fov * Math.PI) / 360)) * Math.tan(Math.asin(Math.min(horizon, 0.999)));
    const dot = Math.max(0.7, screenRadius * DOT_SCALE);
    const e = mvp;
    const R = radius;

    const reach = REACH;
    active = 0;
    for (let i = 0; i < n; i++) {
      // Normal in world space (rotation only), then how squarely it faces the camera.
      const nx = (m[0] * ux[i] + m[4] * uy[i] + m[8] * uz[i]) / scale;
      const ny = (m[1] * ux[i] + m[5] * uy[i] + m[9] * uz[i]) / scale;
      const nz = (m[2] * ux[i] + m[6] * uy[i] + m[10] * uz[i]) / scale;
      const lean = (nx * cx + ny * cy + nz * cz) / distance;
      const visible = lean > horizon;
      facing[i] = visible ? (lean - horizon) / (1 - horizon) : 0;
      if (visible) {
        const px = R * ux[i];
        const py = R * uy[i];
        const pz = R * uz[i];
        const w = e[3] * px + e[7] * py + e[11] * pz + e[15];
        sx[i] = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) / w * 0.5 + 0.5) * width;
        sy[i] = (-(e[1] * px + e[5] * py + e[9] * pz + e[13]) / w * 0.5 + 0.5) * height;
      }

      // Pointer push, on dots the pointer can see.
      if (hand && visible) {
        const dx = sx[i] + ox[i] - hand.x;
        const dy = sy[i] + oy[i] - hand.y;
        const dd = Math.hypot(dx, dy);
        if (dd < reach && dd > 0.01) {
          const f = Math.pow(1 - dd / reach, 2) * PUSH;
          vx[i] += (dx / dd) * f * dt;
          vy[i] += (dy / dd) * f * dt;
        }
      }

      // Spring home (offset → 0), skipping dots already at rest.
      if (ox[i] || oy[i] || vx[i] || vy[i]) {
        vx[i] = (vx[i] - ox[i] * 0.05 * dt) * Math.pow(0.84, dt);
        vy[i] = (vy[i] - oy[i] * 0.05 * dt) * Math.pow(0.84, dt);
        ox[i] += vx[i] * dt;
        oy[i] += vy[i] * dt;
        if (Math.abs(ox[i]) < 0.05 && Math.abs(oy[i]) < 0.05 && Math.abs(vx[i]) < 0.02 && Math.abs(vy[i]) < 0.02) {
          ox[i] = oy[i] = vx[i] = vy[i] = 0;
        } else {
          active++;
        }
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // Keep pushed dots on the sphere: clip to the globe's outline on screen.
    const cw = e[15];
    const centerX = (e[12] / cw * 0.5 + 0.5) * width;
    const centerY = (-e[13] / cw * 0.5 + 0.5) * height;
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, screenRadius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (!facing[i]) continue;
      // Smaller toward the edge of the globe, so it still reads as round.
      const r = dot * (0.3 + 0.7 * Math.sqrt(facing[i]));
      const x = sx[i] + ox[i];
      const y = sy[i] + oy[i];
      const speed = Math.hypot(vx[i], vy[i]);
      if (speed < 0.3) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      } else {
        // Long along its path, a little thin across it.
        const s = Math.min(2.6, 1 + speed * 0.12);
        const rot = Math.atan2(vy[i], vx[i]);
        ctx.moveTo(x + Math.cos(rot) * r * s, y + Math.sin(rot) * r * s);
        ctx.ellipse(x, y, r * s, r / Math.sqrt(s), rot, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.restore();

    // A thin outline so the sphere's edge is visible without an ocean.
    ctx.beginPath();
    ctx.arc(centerX, centerY, screenRadius, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = outline;
    ctx.stroke();
  }

  function start() {
    if (!raf && inView) {
      prev = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // Only run while the globe is on screen.
  const visibility = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) start();
    else stop();
  });
  visibility.observe(canvas.parentElement ?? canvas);
  start();

  function toCanvas(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  return {
    pointer(clientX, clientY) {
      if (still) return;
      hand = toCanvas(clientX, clientY);
      handMoved = true;
    },
    release() {
      hand = null;
      handMoved = true;
    },
    shockwave(clientX, clientY) {
      if (still) return;
      const p = toCanvas(clientX, clientY);
      for (let i = 0; i < n; i++) {
        if (!facing[i]) continue;
        const dx = sx[i] + ox[i] - p.x;
        const dy = sy[i] + oy[i] - p.y;
        const dd = Math.hypot(dx, dy);
        if (dd > WAVE_REACH || dd < 0.01) continue;
        const f = (1 - dd / WAVE_REACH) * WAVE;
        vx[i] += (dx / dd) * f;
        vy[i] += (dy / dd) * f;
      }
      active = Math.max(active, 1);
    },
    destroy() {
      stop();
      visibility.disconnect();
      canvas.remove();
    },
  };
}
