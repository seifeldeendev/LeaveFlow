/* Landing hero background: flowing silk ribbons on <canvas>, in the LeaveFlow greens and teals.
   Each ribbon is a bundle of thin strands following one wavy centre line. The ribbon's width
   breathes along its length, so it looks like it twists; where it narrows the strands bunch up
   and glow, which gives the glossy highlight. Strands add up with "lighter" blending. */
(function () {
  const cvs = document.getElementById("silk");
  if (!cvs) return;
  const ctx = cvs.getContext("2d");
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, DPR = 1;

  // rgb, centre line c(u,t) in H units, width (H units), twist frequency, speed, strand count, base alpha
  const RIBBONS = [
    { rgb: [0, 237, 100], c: (u, t) => 0.78 - 0.5 * u + 0.09 * Math.sin(u * 3.2 + t * 0.35), w: 0.26, g: 2.3, s: 0.22, n: 54, a: 0.16 },
    { rgb: [63, 233, 200], c: (u, t) => 0.12 + 0.5 * u + 0.11 * Math.sin(u * 2.4 - t * 0.3 + 1), w: 0.2, g: 3.0, s: -0.27, n: 44, a: 0.13 },
    { rgb: [0, 163, 92], c: (u, t) => 1.02 - 0.24 * Math.sin(u * Math.PI) + 0.05 * Math.sin(u * 4 + t * 0.4), w: 0.3, g: 1.7, s: 0.18, n: 50, a: 0.12 },
    { rgb: [96, 165, 250], c: (u, t) => -0.04 + 0.18 * Math.sin(u * Math.PI * 1.2 + 0.4) + 0.04 * Math.sin(u * 5 - t * 0.5), w: 0.14, g: 2.8, s: 0.3, n: 30, a: 0.08 }
  ];
  const STOPS = 10;

  function resize() {
    const r = cvs.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    DPR = Math.min(1.5, window.devicePixelRatio || 1);
    cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function ribbon(rb, t) {
    const x0 = -0.1 * W, x1 = 1.1 * W, dx = Math.max(10, W / 110);
    const width = (u) => rb.w * H * (0.18 + 0.82 * Math.abs(Math.sin(u * rb.g + t * rb.s)));
    // brightness along the ribbon: brightest where it is narrow (the twist)
    const glow = [];
    for (let k = 0; k <= STOPS; k++) {
      const u = k / STOPS * 1.2 - 0.1;
      const narrow = 1 - width(u) / (rb.w * H);
      glow.push(0.12 + 0.88 * Math.pow(narrow, 2.2));
    }
    const [r, g, b] = rb.rgb;
    for (let k = 0; k <= rb.n; k++) {
      const f = k / rb.n - 0.5;
      const edge = 0.35 + 0.65 * Math.pow(Math.abs(f * 2), 1.6); // edges of the ribbon catch more light
      const grad = ctx.createLinearGradient(x0, 0, x1, 0);
      for (let s = 0; s <= STOPS; s++) {
        const fade = Math.min(1, s / 2, (STOPS - s) / 2); // soft ends
        grad.addColorStop(s / STOPS, "rgba(" + r + "," + g + "," + b + "," + (rb.a * edge * glow[s] * (0.4 + 0.6 * fade)).toFixed(3) + ")");
      }
      ctx.strokeStyle = grad;
      ctx.beginPath();
      for (let x = x0; x <= x1 + dx; x += dx) {
        const u = x / W;
        const y = rb.c(u, t) * H + f * width(u);
        x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function render(time) {
    if (!W) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.1;
    RIBBONS.forEach((rb) => ribbon(rb, time));
    ctx.globalCompositeOperation = "source-over";
  }

  resize();
  new ResizeObserver(() => { resize(); if (reduced) render(4); }).observe(cvs);
  if (reduced) { render(4); return; }

  let visible = true, raf = 0; const t0 = performance.now();
  const loop = (now) => { render((now - t0) / 1000 + 4); raf = requestAnimationFrame(loop); };
  const sync = () => { cancelAnimationFrame(raf); if (visible && !document.hidden) raf = requestAnimationFrame(loop); };
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; sync(); }).observe(cvs);
  document.addEventListener("visibilitychange", sync);
  sync();
})();
