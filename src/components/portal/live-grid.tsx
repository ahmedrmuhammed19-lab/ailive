"use client";

import { useEffect, useRef, useState } from "react";

/**
 * LiveGrid — the 2026 blueprint, awake (DL-16).
 *
 * Replaces the static `.eis-stars` grid with a canvas that keeps the exact
 * same 44px pitch and palette DNA (grid line + accent read live from the
 * --eis-* tokens, so light/dark theme switches re-tune it instantly) and
 * adds three layers of life:
 *
 *   1. Pointer halo  — grid cells under/around the cursor charge with azure
 *                      energy and breathe it back out (fast rise, slow decay).
 *   2. Signal pulses — small comets that periodically travel along grid
 *                      lines, so the sheet is alive even before any input
 *                      (and on touch devices).
 *   3. Tap ripples   — a soft azure ring expanding from every click/tap.
 *
 * Engineering guardrails: devicePixelRatio capped at 2, the static grid is
 * prerendered once per resize/theme change and blitted, the rAF loop pauses
 * when the tab is hidden, pointer-events stay none (page interactions are
 * never blocked), and `prefers-reduced-motion` swaps the whole thing for
 * the original static `.eis-stars` span.
 */

const CELL = 44; // grid pitch — must match the .eis-stars DNA
const HALO = 180; // pointer influence radius (px)
const MAX_PULSES = 4;
const MAX_RIPPLES = 6;
const GLOW_KEY = 8192; // energy map key stride (row * GLOW_KEY + col)

type Pulse = {
  horizontal: boolean; // travel along a horizontal line?
  line: number; // grid line index (y for horizontal, x for vertical)
  pos: number; // head position along the travel axis (px)
  dir: 1 | -1;
  speed: number; // px/s
  tail: number; // trail length (px)
  t: number; // age (s)
  maxT: number; // lifetime (s)
};

type Ripple = { x: number; y: number; t: number; dur: number };

export function LiveGrid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [reduced, setReduced] = useState(false);

  // Reduced-motion users get the original calm static grid.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let disposed = false;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let gridLayer: HTMLCanvasElement | null = null;

    let px = -1e5; // pointer (viewport px; parked far away when idle)
    let py = -1e5;
    const energy = new Map<number, number>(); // cell -> 0..1
    const pulses: Pulse[] = [];
    const ripples: Ripple[] = [];

    let gridStroke = "rgba(0, 86, 119, 0.055)"; // --eis-grid-line (light default)
    let glowRGB = "0, 114, 166"; // --eis-accent parsed (light default)
    let dark = document.documentElement.classList.contains("dark");
    let nextPulseIn = 0.6; // spawn the first comet quickly — first paint feels alive

    const hexToRGB = (hex: string): string | null => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    };

    const readPalette = () => {
      const cs = getComputedStyle(canvas);
      const line = cs.getPropertyValue("--eis-grid-line").trim();
      if (line) gridStroke = line;
      const accent = hexToRGB(cs.getPropertyValue("--eis-accent") || "");
      if (accent) glowRGB = accent;
      dark = document.documentElement.classList.contains("dark");
    };

    // Prerender the static blueprint grid at device resolution; blitted
    // every frame so the dynamic layer never redraws ~70 hairlines.
    const renderGridLayer = () => {
      gridLayer = document.createElement("canvas");
      gridLayer.width = canvas.width;
      gridLayer.height = canvas.height;
      const g = gridLayer.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.strokeStyle = gridStroke;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0.5; x <= w; x += CELL) {
        g.moveTo(x, 0);
        g.lineTo(x, h);
      }
      for (let y = 0.5; y <= h; y += CELL) {
        g.moveTo(0, y);
        g.lineTo(w, y);
      }
      g.stroke();
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderGridLayer();
    };

    const spawnPulse = (warmup = false) => {
      if (pulses.length >= MAX_PULSES) return;
      const horizontal = Math.random() < 0.5;
      const span = horizontal ? h : w;
      const lines = Math.max(2, Math.round((horizontal ? h : w) / CELL));
      const line = Math.floor(Math.random() * (lines + 1));
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      const travel = 420 + Math.random() * 520;
      const speed = 95 + Math.random() * 85;
      const maxT = travel / speed;
      const start = dir === 1 ? -40 : span + 40;
      pulses.push({
        horizontal,
        line: line * CELL,
        pos: warmup ? Math.random() * span : start,
        dir,
        speed,
        tail: 170 + Math.random() * 130,
        t: 0,
        maxT,
      });
    };

    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
    };
    const onLeave = () => {
      px = -1e5;
      py = -1e5;
    };
    const onDown = (e: PointerEvent) => {
      if (ripples.length < MAX_RIPPLES) ripples.push({ x: e.clientX, y: e.clientY, t: 0, dur: 0.9 });
      // Kick the cells under the tap so it lands with a bloom, not just a ring.
      const c = Math.floor(e.clientX / CELL);
      const r = Math.floor(e.clientY / CELL);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const k = (r + dr) * GLOW_KEY + (c + dc);
          energy.set(k, Math.min(1, (energy.get(k) ?? 0) + 0.85));
        }
      }
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!disposed && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const themeObs = new MutationObserver(() => {
      readPalette();
      renderGridLayer();
    });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const smooth = (x: number) => x * x * (3 - 2 * x);

    let last = performance.now();
    const frame = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tf = dark ? 1 : 0.62; // theme factor — porcelain stays quiet

      // --- charge cells under the pointer ---
      const reach = Math.ceil(HALO / CELL);
      const pc = Math.floor(px / CELL);
      const pr = Math.floor(py / CELL);
      for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) {
          const cx = (pc + dc) * CELL + CELL / 2;
          const cy = (pr + dr) * CELL + CELL / 2;
          const d = Math.hypot(cx - px, cy - py);
          if (d > HALO) continue;
          const target = smooth(1 - d / HALO);
          const k = (pr + dr) * GLOW_KEY + (pc + dc);
          const cur = energy.get(k) ?? 0;
          energy.set(k, cur + (target - cur) * Math.min(1, dt * 14));
        }
      }

      // --- decay everything; retire cold cells ---
      const cool = Math.exp(-dt * 1.9);
      for (const [k, v] of energy) {
        const nv = v * cool;
        if (nv < 0.004) energy.delete(k);
        else energy.set(k, nv);
      }

      // --- ambient comets ---
      nextPulseIn -= dt;
      if (nextPulseIn <= 0) {
        spawnPulse();
        nextPulseIn = 2.4 + Math.random() * 2.6;
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += dt;
        p.pos += p.dir * p.speed * dt;
        if (p.t >= p.maxT) pulses.splice(i, 1);
      }

      // --- ripples ---
      for (let i = ripples.length - 1; i >= 0; i--) {
        ripples[i].t += dt;
        if (ripples[i].t >= ripples[i].dur) ripples.splice(i, 1);
      }

      // --- paint ---
      ctx.clearRect(0, 0, w, h);
      if (gridLayer) ctx.drawImage(gridLayer, 0, 0, w, h);

      for (const [k, v] of energy) {
        if (v < 0.004) continue;
        const c = k % GLOW_KEY;
        const r = (k - c) / GLOW_KEY;
        const cx = c * CELL + CELL / 2;
        const cy = r * CELL + CELL / 2;
        const rad = CELL * 1.4;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0, `rgba(${glowRGB}, ${(0.2 * v * tf).toFixed(4)})`);
        grad.addColorStop(1, `rgba(${glowRGB}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        ctx.fillStyle = `rgba(${glowRGB}, ${(0.7 * v * tf).toFixed(4)})`;
        ctx.fillRect(cx - 0.75, cy - 0.75, 1.5, 1.5);
      }

      for (const p of pulses) {
        const env = Math.sin(Math.PI * Math.min(1, p.t / p.maxT));
        const a = env * (dark ? 0.5 : 0.34);
        if (a <= 0.01) continue;
        const y = p.horizontal ? p.line : 0;
        const x = p.horizontal ? 0 : p.line;
        const hx = p.horizontal ? p.pos : x;
        const hy = p.horizontal ? y : p.pos;
        const tx = p.horizontal ? p.pos - p.dir * p.tail : x;
        const ty = p.horizontal ? y : p.pos - p.dir * p.tail;
        const grad = ctx.createLinearGradient(tx, ty, hx, hy);
        grad.addColorStop(0, `rgba(${glowRGB}, 0)`);
        grad.addColorStop(1, `rgba(${glowRGB}, ${a.toFixed(4)})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.fillStyle = `rgba(${glowRGB}, ${(a * 0.9).toFixed(4)})`;
        ctx.beginPath();
        ctx.arc(hx, hy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const rp of ripples) {
        const pr2 = rp.t / rp.dur;
        const eased = 1 - Math.pow(1 - pr2, 3);
        const rad = 8 + eased * 148;
        const a = (1 - pr2) * (dark ? 0.45 : 0.3);
        ctx.strokeStyle = `rgba(${glowRGB}, ${a.toFixed(4)})`;
        ctx.lineWidth = 1.5 * (1 - pr2) + 0.4;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rad, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(frame);
    };

    readPalette();
    resize();
    spawnPulse(true);
    spawnPulse(true);
    spawnPulse(true);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      themeObs.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduced]);

  if (reduced) return <span className="eis-stars" aria-hidden="true" />;
  return <canvas ref={canvasRef} className="eis-live-grid" aria-hidden="true" />;
}
