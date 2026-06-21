/**
 * Tiny dependency-free confetti burst. Fires a one-shot spray of paper from a
 * screen point (e.g. a lifecycle stepper node) — used to celebrate a job hitting
 * Confirmed / Completed. No npm dependency on purpose (keeps the lockfile clean).
 *
 * Usage:
 *   import { fireConfetti, fireConfettiFromElement } from "@/lib/confetti";
 *   fireConfettiFromElement(nodeEl);
 */

// RVLT palette — brand red + the semantic accents + ink, for a festive mix.
const COLORS = ["#E0363D", "#B21F26", "#4FD888", "#EBA53A", "#5B8DEF", "#F5EFE2"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rot: number;
  vrot: number;
  life: number; // 0..1 remaining
  decay: number;
}

/** Fire confetti from a viewport pixel coordinate. */
export function fireConfetti(
  origin: { x: number; y: number },
  opts: { count?: number; spread?: number; power?: number } = {},
): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  // Respect reduced-motion — no surprise bursts for folks who opt out.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

  const count = opts.count ?? 110;
  const power = opts.power ?? 14;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  document.body.appendChild(canvas);

  const particles: Particle[] = Array.from({ length: count }, () => {
    // Spray upward and out: angle biased toward "up", random magnitude.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (opts.spread ?? Math.PI * 0.9);
    const speed = power * (0.4 + Math.random() * 0.9);
    return {
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.4,
      life: 1,
      decay: 0.008 + Math.random() * 0.01,
    };
  });

  const GRAVITY = 0.32;
  const DRAG = 0.985;
  let raf = 0;

  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      if (p.life <= 0) continue;
      alive = true;
      p.vx *= DRAG;
      p.vy = p.vy * DRAG + GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      p.life -= p.decay;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      // little paper rectangles
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (alive) {
      raf = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };
  raf = requestAnimationFrame(tick);

  // Hard safety cap — never leak a canvas even if the tab backgrounds.
  window.setTimeout(() => {
    cancelAnimationFrame(raf);
    canvas.remove();
  }, 5000);
}

/** Fire confetti from the centre of a DOM element. */
export function fireConfettiFromElement(
  el: HTMLElement | null | undefined,
  opts?: { count?: number; spread?: number; power?: number },
): void {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  fireConfetti({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, opts);
}
