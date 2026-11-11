"use client";
import { useEffect, useRef } from "react";

// A decorative wireframe landscape for the connection panel. It carries no account data.
export function SignalArt() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const w = element.clientWidth,
        h = element.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.max(1, w * ratio);
      element.height = Math.max(1, h * ratio);
      const c = element.getContext("2d");
      if (!c || !w || !h) return;
      c.scale(ratio, ratio);
      const glow = c.createRadialGradient(
        w * 0.72,
        h * 0.5,
        0,
        w * 0.7,
        h * 0.6,
        w * 0.65,
      );
      glow.addColorStop(0, "#175349");
      glow.addColorStop(1, "#092c2b");
      c.fillStyle = glow;
      c.fillRect(0, 0, w, h);
      c.fillStyle = "rgba(181,232,196,.19)";
      for (let y = 9; y < h; y += 16)
        for (let x = 5; x < w; x += 16) c.fillRect(x, y, 1, 1);
      const project = (u: number, v: number) => {
        const z =
          0.46 *
            Math.exp(-((u - 0.59) ** 2 / 0.017 + (v - 0.56) ** 2 / 0.063)) +
          0.22 *
            Math.exp(-((u - 0.91) ** 2 / 0.055 + (v - 0.32) ** 2 / 0.019)) +
          0.16 *
            Math.exp(-((u - 0.26) ** 2 / 0.038 + (v - 0.72) ** 2 / 0.037)) +
          0.023 * Math.sin(u * 15 + v * 6) * Math.cos(v * 8);
        return [(u * 1.27 + v * 0.2 - 0.18) * w, (0.35 + v * 0.72 - z) * h];
      };
      for (let j = 0; j <= 75; j++) {
        const v = j / 75;
        c.beginPath();
        for (let k = 0; k <= 145; k++) {
          const [x, y] = project(k / 145, v);
          if (k === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.strokeStyle =
          "rgba(124,218,170," + (0.25 + 0.52 * Math.sin(v * Math.PI)) + ")";
        c.lineWidth = 0.72;
        c.stroke();
      }
      for (let i = 0; i <= 85; i++) {
        c.beginPath();
        for (let j = 0; j <= 75; j++) {
          const [x, y] = project(i / 85, j / 75);
          if (j === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.strokeStyle = "rgba(137,224,179,.18)";
        c.lineWidth = 0.55;
        c.stroke();
      }
      for (const [u, v] of [
        [0.59, 0.56],
        [0.34, 0.72],
        [0.87, 0.35],
      ]) {
        const [x, y] = project(u, v);
        c.beginPath();
        c.arc(x, y, 5, 0, Math.PI * 2);
        c.fillStyle = "rgba(191,250,169,.19)";
        c.fill();
        c.beginPath();
        c.arc(x, y, 1.9, 0, Math.PI * 2);
        c.fillStyle = "#c9f8a1";
        c.fill();
      }
      c.strokeStyle = "rgba(194,240,197,.55)";
      c.lineWidth = 1;
      [
        [w - 20, 16],
        [w - 20, h - 16],
      ].forEach(([x, y]) => {
        c.beginPath();
        c.moveTo(x - 3, y);
        c.lineTo(x + 3, y);
        c.moveTo(x, y - 3);
        c.lineTo(x, y + 3);
        c.stroke();
      });
    };
    const obs = new ResizeObserver(draw);
    obs.observe(element);
    draw();
    return () => obs.disconnect();
  }, []);
  return <canvas ref={canvas} className="signal-art" aria-hidden="true" />;
}
