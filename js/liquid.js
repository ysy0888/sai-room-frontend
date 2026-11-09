var SaiLiquid = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/motion/index.ts
  var index_exports = {};
  __export(index_exports, {
    acceptSnapshot: () => acceptSnapshot,
    createLiquidRenderer: () => createLiquidRenderer,
    occupancyLabel: () => occupancyLabel,
    occupancyTone: () => occupancyTone,
    orientationSlope: () => orientationSlope,
    validSnapshot: () => validSnapshot
  });

  // src/motion/model.ts
  var clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
  function validSnapshot(value) {
    if (!value || typeof value !== "object") return false;
    const v = value;
    return Number.isInteger(v.count) && v.count >= 0 && v.count <= 1e4 && Number.isInteger(v.referenceCapacity) && v.referenceCapacity > 0 && v.referenceCapacity <= 1e4 && typeof v.observedAt === "string" && Number.isFinite(Date.parse(v.observedAt)) && Number.isSafeInteger(v.sequence) && v.sequence >= 0;
  }
  function acceptSnapshot(previous, incoming) {
    if (!validSnapshot(incoming)) return previous;
    if (previous && (incoming.sequence <= previous.sequence || Date.parse(incoming.observedAt) < Date.parse(previous.observedAt))) return previous;
    return incoming;
  }
  function occupancyLabel(count, capacity) {
    if (count === 0) return "\uAC10\uC9C0 \uC778\uC6D0 \uC5C6\uC74C";
    const r = count / capacity;
    return r < 0.4 ? "\uC5EC\uC720" : r < 0.7 ? "\uBCF4\uD1B5" : r < 1 ? "\uD63C\uC7A1" : r === 1 ? "\uAE30\uC900 \uC778\uC6D0 \uB3C4\uB2EC" : "\uAE30\uC900 \uC778\uC6D0 \uCD08\uACFC";
  }
  function occupancyTone(ratio) {
    const stops = [[0, [158, 181, 222]], [0.45, [147, 163, 204]], [0.72, [179, 151, 189]], [1, [216, 143, 166]]];
    const r = clamp(ratio);
    for (let i = 1; i < stops.length; i++) {
      const [b, cb] = stops[i], [a, ca] = stops[i - 1];
      if (r <= b) return mix(ca, cb, (r - a) / (b - a));
    }
    return stops[stops.length - 1][1];
  }
  function mix(a, b, t) {
    return a.map((n, i) => n + (b[i] - n) * t);
  }
  var rgb = (c, alpha = 1) => `rgba(${c.map(Math.round).join(",")},${alpha})`;
  function fillSurface(ratio, width = 264, height = 276, radius = 76) {
    const r = clamp(ratio);
    if (r === 0) return height;
    if (r === 1) return 0;
    const total = width * height - (4 - Math.PI) * radius * radius;
    function areaAbove(y) {
      const segment = (h) => {
        const z = clamp(h, 0, radius) - radius;
        return (width - 2 * radius) * h + z * Math.sqrt(Math.max(0, radius * radius - z * z)) + radius * radius * (Math.asin(clamp(z / radius, -1, 1)) + Math.PI / 2);
      };
      if (y < radius) return segment(y);
      if (y > height - radius) return total - segment(height - y);
      return segment(radius) + (y - radius) * width;
    }
    let lo = 0, hi = height;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (areaAbove(m) < total * (1 - r)) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  }
  function advanceSpring(s, target, seconds, stiffness = 95, damping = 18) {
    let p = s.position, v = s.velocity;
    const total = clamp(seconds, 0, 0.1), steps = Math.max(1, Math.ceil(total / 8e-3)), dt = total / steps;
    for (let i = 0; i < steps; i++) {
      v += (stiffness * (target - p) - damping * v) * dt;
      p += v * dt;
    }
    if (Math.abs(target - p) < 5e-5 && Math.abs(v) < 1e-4) return { position: target, velocity: 0 };
    return { position: p, velocity: v };
  }
  var vesselColumns = Array.from({ length: 80 }, (_, i) => {
    const x = (i + 0.5) * 264 / 80, edge = Math.min(x, 264 - x), inset = edge >= 76 ? 0 : 76 - Math.sqrt(76 * 76 - (76 - edge) ** 2);
    return { x: x - 132, top: inset, bottom: 276 - inset };
  });
  function tiltedSurface(ratio, slope) {
    const r = clamp(ratio);
    if (!r) return 400;
    if (r === 1) return -124;
    if (Math.abs(slope) < 1e-4) return fillSurface(r);
    const total = vesselColumns.reduce((n, c) => n + c.bottom - c.top, 0), target = total * r;
    let lo = -124, hi = 400;
    for (let i = 0; i < 14; i++) {
      const y = (lo + hi) / 2, area = vesselColumns.reduce((n, c) => n + clamp(c.bottom - y - slope * c.x, 0, c.bottom - c.top), 0);
      if (area > target) lo = y;
      else hi = y;
    }
    return (lo + hi) / 2;
  }
  function orientationSlope(beta, gamma, screenAngle = 0) {
    const rad = Math.PI / 180, b = beta * rad, g = gamma * rad, a = screenAngle * rad;
    const gx = Math.cos(b) * Math.sin(g), gy = Math.sin(b), x = gx * Math.cos(a) + gy * Math.sin(a), y = gy * Math.cos(a) - gx * Math.sin(a);
    if (Math.hypot(x, y) < 0.15) return 0;
    return clamp(-x / Math.max(0.25, Math.abs(y)), -0.36, 0.36);
  }

  // src/motion/renderer.ts
  var levels = Array.from({ length: 401 }, (_, i) => fillSurface(i / 400));
  var surface = (r) => {
    const n = clamp(r) * 400, i = Math.floor(n);
    return 32 + levels[i] + ((levels[i + 1] ?? levels[i]) - levels[i]) * (n - i);
  };
  var round = (c, x, y, w, h, r) => {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
  };
  function createLiquidRenderer(canvas, initial) {
    const c = canvas.getContext("2d");
    if (!c) return { update() {
    }, point() {
    }, ripple() {
    }, tilt() {
    }, destroy() {
    } };
    let options = { ...initial }, spring = { position: clamp(initial.ratio), velocity: 0 }, raf = 0, last = 0, phase = 0, energy = 0, width = 360, height = 370, dpr = 1, visible = true, disposed = false;
    let tiltTarget = 0, tiltSpring = { position: 0, velocity: 0 };
    let pointerX = 0, pointerY = 0, lightX = 0, lightY = 0, paintedAt = 0;
    const grain = document.createElement("canvas");
    grain.width = grain.height = 96;
    const gc = grain.getContext("2d");
    const pixels = gc.createImageData(96, 96);
    let seed = 1717;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = seed * 1664525 + 1013904223 >>> 0;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = seed >>> 24;
      pixels.data[i + 3] = seed % 4;
    }
    gc.putImageData(pixels, 0, 0);
    const texture = c.createPattern(grain, "repeat");
    function wave(y, offset, amplitude, close = true) {
      c.beginPath();
      for (let x = 36; x <= 324; x += 2) {
        const xx = (x - 180) / 144;
        const yy = y + Math.sin(x * 0.024 + phase + offset) * amplitude + Math.sin(x * 0.047 - phase * 0.7 + offset) * amplitude * 0.24 + (x - 180) * tiltSpring.position;
        if (x === 36) c.moveTo(x, yy);
        else c.lineTo(x, yy);
      }
      if (close) {
        c.lineTo(324, 320);
        c.lineTo(36, 320);
        c.closePath();
      }
    }
    function draw() {
      if (!c) return;
      const { material, reduced, paused, dark } = options, matte = material === "frost", ceramic = material === "ceramic";
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, width, height);
      c.save();
      c.scale(width / 360, height / 370);
      const ratio = clamp(spring.position), col = occupancyTone(ratio), light = mix(col, [250, 250, 255], 0.45), deep = mix(col, [31, 50, 103], 0.36), y = Math.abs(tiltSpring.position) < 1e-4 ? surface(ratio) : 32 + tiltedSurface(ratio, tiltSpring.position);
      const amp = paused || reduced ? 0 : (matte ? 3.2 : 5.5) + energy * 6 + Math.min(5, Math.abs(spring.velocity) * 8);
      const shadow = c.createRadialGradient(180, 328, 14, 180, 328, 139);
      shadow.addColorStop(0, dark ? "#09112760" : "#192b5620");
      shadow.addColorStop(0.7, "#192b5608");
      shadow.addColorStop(1, "#192b5600");
      c.save();
      c.translate(0, 220);
      c.scale(1, 0.32);
      c.fillStyle = shadow;
      c.fillRect(20, 200, 320, 220);
      c.restore();
      c.save();
      c.shadowColor = dark ? "#09112860" : "#26375c1d";
      c.shadowBlur = 18;
      c.shadowOffsetY = 12;
      round(c, 29, 16, 302, 306, 89);
      c.fillStyle = ceramic ? "#f0e7ea" : "#e4e8f3";
      c.fill();
      c.restore();
      const rim = c.createLinearGradient(38, 10, 321, 325);
      [[0, "#ffffff"], [0.16, "#e6eaf4"], [0.36, "#ffffff"], [0.62, "#c2cada"], [0.79, "#fafcff"], [1, "#dae0ed"]].forEach(([s, v]) => rim.addColorStop(s, v));
      round(c, 29, 16, 302, 306, 89);
      c.fillStyle = ceramic ? "#f1e8ed" : rim;
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = "#ffffff90";
      c.stroke();
      round(c, 48, 32, 264, 276, 76);
      c.save();
      c.clip();
      const cavity = c.createLinearGradient(45, 35, 302, 305);
      cavity.addColorStop(0, ceramic ? "#fcf7fa" : "#f7f9fe");
      cavity.addColorStop(0.6, "#eef2fa");
      cavity.addColorStop(1, "#d9e1ef");
      c.fillStyle = cavity;
      c.fillRect(40, 25, 282, 290);
      let shade = c.createRadialGradient(165 + lightX * 18, 130 + lightY * 12, 25, 180, 160, 200);
      shade.addColorStop(0, "#ffffff60");
      shade.addColorStop(0.75, "#ffffff00");
      shade.addColorStop(1, "#24376b1e");
      c.fillStyle = shade;
      c.fillRect(40, 25, 282, 290);
      if (ratio > 0) {
        wave(y - 3, 1.7, amp * 0.8);
        c.fillStyle = rgb(light, 0.8);
        c.fill();
        const fluid = c.createLinearGradient(0, y - 5, 0, 310);
        fluid.addColorStop(0, rgb(light));
        fluid.addColorStop(0.12, rgb(mix(col, [249, 249, 255], 0.2)));
        fluid.addColorStop(0.66, rgb(col));
        fluid.addColorStop(1, rgb(deep));
        wave(y, 0, amp);
        c.fillStyle = fluid;
        c.fill();
        c.save();
        wave(y, 0, amp);
        c.clip();
        const refraction = c.createLinearGradient(48, 0, 312, 0);
        [[0, "#1b2d6230"], [0.035, "#ffffffa0"], [0.085, "#ffffff08"], [0.3, "#ffffff00"], [0.78, "#4b245705"], [0.94, "#59234e32"], [1, "#ffffff70"]].forEach(([s, v]) => refraction.addColorStop(s, v));
        c.fillStyle = refraction;
        c.fillRect(45, 30, 270, 285);
        if (!matte && !ceramic) {
          for (let j = 0; j < 6; j++) {
            c.beginPath();
            for (let x = 48; x < 314; x += 3) {
              const yy = 271 + j * 5 + Math.sin(x * 0.031 + phase * 0.28 + j * 0.7) * 11;
              x === 48 ? c.moveTo(x, yy) : c.lineTo(x, yy);
            }
            c.strokeStyle = `rgba(245,248,255,${0.17 - j * 0.02})`;
            c.lineWidth = 1.1 + j * 0.45;
            c.stroke();
          }
          for (let j = 0; j < 13; j++) {
            const bx = 65 + j * 47 % 230, by = 305 - (j * 43 + phase * 5) % 270, r = 1 + j % 3 * 0.65;
            if (by < y + 8) continue;
            c.beginPath();
            c.arc(bx, by, r, 0, Math.PI * 2);
            c.strokeStyle = "#f7f9ff65";
            c.lineWidth = 0.7;
            c.stroke();
            c.beginPath();
            c.arc(bx - 0.4, by - 0.5, 0.6, 0, Math.PI * 2);
            c.fillStyle = "#ffffffa0";
            c.fill();
          }
        }
        c.restore();
        wave(y, 0, amp, false);
        c.strokeStyle = rgb(mix(light, [255, 255, 255], 0.62), 0.85);
        c.lineWidth = 2.2;
        c.stroke();
        c.save();
        c.translate(0, 2);
        wave(y, 0, amp, false);
        c.strokeStyle = rgb(deep, 0.25);
        c.lineWidth = 0.8;
        c.stroke();
        c.restore();
      }
      const readingGlow = c.createRadialGradient(180, 150, 15, 180, 170, 130);
      readingGlow.addColorStop(0, "#ffffff4d");
      readingGlow.addColorStop(1, "#ffffff00");
      c.fillStyle = readingGlow;
      c.fillRect(45, 32, 270, 276);
      if (matte) {
        c.fillStyle = "#f5f7ff38";
        c.fillRect(40, 25, 282, 290);
      }
      if (texture) {
        c.fillStyle = texture;
        c.fillRect(40, 25, 282, 290);
      }
      c.restore();
      round(c, 47.5, 31.5, 265, 277, 77);
      c.strokeStyle = ceramic ? "#a5789445" : "#6c7ea040";
      c.lineWidth = 1.2;
      c.stroke();
      round(c, 35, 22, 290, 294, 84);
      c.strokeStyle = "#ffffffb0";
      c.lineWidth = 1.5;
      c.stroke();
      if (!matte && !ceramic) {
        c.save();
        round(c, 46, 30, 268, 280, 78);
        c.clip();
        const shine = c.createLinearGradient(52 + lightX * 3, 0, 88 + lightX * 3, 0);
        shine.addColorStop(0, "#ffffff00");
        shine.addColorStop(0.4, "#ffffff65");
        shine.addColorStop(1, "#ffffff00");
        c.fillStyle = shine;
        c.beginPath();
        c.ellipse(66 + lightX * 3, 136 + lightY * 4, 9, 83, -0.04, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
      for (let i = 0; i < 5; i++) {
        const yy = 75 + i * 44;
        c.beginPath();
        c.moveTo(286, yy);
        c.lineTo(i % 2 ? 290 : 293, yy);
        c.strokeStyle = "#283f6a35";
        c.lineWidth = 1;
        c.stroke();
      }
      c.restore();
    }
    function frame(t) {
      raf = 0;
      if (disposed || !visible || document.hidden) return;
      const dt = last ? Math.min(0.1, (t - last) / 1e3) : 0.016;
      last = t;
      spring = options.reduced ? { position: clamp(options.ratio), velocity: 0 } : advanceSpring(spring, clamp(options.ratio), dt);
      tiltSpring = options.reduced || options.paused ? { position: 0, velocity: 0 } : advanceSpring(tiltSpring, tiltTarget, dt, 65, 10);
      energy *= Math.exp(-dt * 2.5);
      lightX += (pointerX - lightX) * (1 - Math.exp(-dt * 9));
      lightY += (pointerY - lightY) * (1 - Math.exp(-dt * 9));
      if (!options.paused && !options.reduced) phase += dt * 1.25;
      if (t - paintedAt > 1e3 / 45 || options.reduced) {
        draw();
        paintedAt = t;
      }
      if (!options.reduced && (!options.paused || Math.abs(clamp(options.ratio) - spring.position) > 1e-4)) raf = requestAnimationFrame(frame);
    }
    function wake() {
      cancelAnimationFrame(raf);
      last = 0;
      draw();
      if (!disposed && visible && !document.hidden) raf = requestAnimationFrame(frame);
    }
    const resize = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      width = Math.max(1, r.width);
      height = Math.max(1, r.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      wake();
    });
    resize.observe(canvas);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
      else cancelAnimationFrame(raf);
    });
    observer.observe(canvas);
    const visibility = () => document.hidden ? cancelAnimationFrame(raf) : wake();
    document.addEventListener("visibilitychange", visibility);
    return { update(next) {
      if (next.ratio !== void 0 && next.ratio !== options.ratio) energy = Math.min(1.2, Math.abs(next.ratio - options.ratio) * 4);
      options = { ...options, ...next };
      if (options.reduced) spring = { position: clamp(options.ratio), velocity: 0 };
      wake();
    }, point(x, y) {
      pointerX = clamp(x, -1, 1);
      pointerY = clamp(y, -1, 1);
    }, ripple() {
      if (options.reduced || options.paused) return;
      energy = 0.8;
      wake();
    }, tilt(slope, impulse = 0) {
      if (options.reduced || options.paused) return;
      tiltTarget = clamp(slope, -0.36, 0.36);
      energy = Math.min(1.5, energy + clamp(impulse, 0, 0.35));
      if (!raf) wake();
    }, destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    } };
  }
  return __toCommonJS(index_exports);
})();
