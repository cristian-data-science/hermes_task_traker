import { useEffect, useRef } from "react";
import type { ThemeId } from "../hooks/useTheme";

/**
 * Fondo animado sutil, distinto por tema.
 * - matrix:   lluvia de caracteres (canvas)
 * - terminal: banda de escaneo CRT + parpadeo de fósforo
 * - paper:    glifos tipográficos flotando
 * - brutal:   figuras geométricas girando lentamente
 * Se oculta completo con prefers-reduced-motion (CSS .themed-bg).
 */
export function ThemedBackground({ theme }: { theme: ThemeId }) {
  return (
    <div
      aria-hidden
      className="themed-bg pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {theme === "matrix" && <MatrixRain />}
      {theme === "terminal" && <TerminalScan />}
      {theme === "paper" && <PaperGlyphs />}
      {theme === "brutal" && <BrutalShapes />}
    </div>
  );
}

/* ---------- MATRIX: lluvia de caracteres ---------- */
const MATRIX_CHARS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789<>/*+-=$#";

function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fontSize = 14;
    let w = 0;
    let h = 0;
    let drops: number[] = [];
    let raf = 0;
    let last = 0;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
      const cols = Math.floor(w / fontSize);
      drops = Array.from({ length: cols }, () =>
        Math.floor((Math.random() * -h) / fontSize),
      );
      // Arranque: fondo sólido para que el trail no parta transparente
      ctx!.fillStyle = "#010603";
      ctx!.fillRect(0, 0, w, h);
    }
    resize();
    window.addEventListener("resize", resize);

    function draw(t: number) {
      raf = requestAnimationFrame(draw);
      if (t - last < 55) return; // ~18 fps, sutil y barato
      last = t;

      // Trail: desvanecer con el color del fondo del tema matrix
      ctx!.fillStyle = "rgba(1, 6, 3, 0.10)";
      ctx!.fillRect(0, 0, w, h);
      ctx!.font = `${fontSize}px "JetBrains Mono", monospace`;

      for (let i = 0; i < drops.length; i++) {
        const ch = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
        // Cabeza de la columna más brillante de vez en cuando
        ctx!.fillStyle =
          Math.random() < 0.06
            ? "rgba(200, 255, 223, 0.9)"
            : "rgba(0, 255, 102, 0.55)";
        ctx!.fillText(ch, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > h && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="h-full w-full opacity-25" />;
}

/* ---------- TERMINAL: escaneo CRT ---------- */
function TerminalScan() {
  return (
    <>
      <div className="bg-crt-glow" />
      <div className="bg-scanband" />
    </>
  );
}

/* ---------- PAPER: glifos editoriales flotando ---------- */
const GLYPHS: {
  ch: string;
  left: string;
  top: string;
  size: string;
  dur: string;
  delay: string;
}[] = [
  { ch: "¶", left: "6%", top: "18%", size: "7rem", dur: "26s", delay: "0s" },
  { ch: "&", left: "84%", top: "10%", size: "9rem", dur: "32s", delay: "-8s" },
  { ch: "§", left: "12%", top: "68%", size: "6rem", dur: "24s", delay: "-4s" },
  { ch: "℘", left: "70%", top: "62%", size: "8rem", dur: "30s", delay: "-14s" },
  { ch: "*", left: "45%", top: "30%", size: "10rem", dur: "36s", delay: "-20s" },
  { ch: "„", left: "30%", top: "82%", size: "7rem", dur: "28s", delay: "-10s" },
  { ch: "fi", left: "58%", top: "85%", size: "5rem", dur: "22s", delay: "-6s" },
];

function PaperGlyphs() {
  return (
    <>
      {GLYPHS.map((g, i) => (
        <span
          key={i}
          className="bg-glyph"
          style={{
            left: g.left,
            top: g.top,
            fontSize: g.size,
            animationDuration: g.dur,
            animationDelay: g.delay,
          }}
        >
          {g.ch}
        </span>
      ))}
    </>
  );
}

/* ---------- BRUTAL: figuras geométricas ---------- */
const SHAPES: {
  kind: "circle" | "square" | "triangle";
  left: string;
  top: string;
  size: number;
  dur: string;
  delay: string;
}[] = [
  { kind: "circle", left: "8%", top: "20%", size: 140, dur: "48s", delay: "0s" },
  { kind: "square", left: "78%", top: "12%", size: 110, dur: "56s", delay: "-12s" },
  { kind: "triangle", left: "64%", top: "70%", size: 130, dur: "44s", delay: "-20s" },
  { kind: "square", left: "18%", top: "76%", size: 90, dur: "60s", delay: "-30s" },
  { kind: "circle", left: "44%", top: "44%", size: 180, dur: "70s", delay: "-40s" },
];

function BrutalShapes() {
  return (
    <>
      {SHAPES.map((s, i) => {
        if (s.kind === "triangle") {
          return (
            <svg
              key={i}
              className="bg-shape"
              style={{
                left: s.left,
                top: s.top,
                width: s.size,
                height: s.size,
                animationDuration: s.dur,
                animationDelay: s.delay,
              }}
              viewBox="0 0 100 100"
              fill="none"
            >
              <path
                d="M50 8 L94 88 L6 88 Z"
                stroke="var(--border)"
                strokeWidth="4"
              />
            </svg>
          );
        }
        return (
          <span
            key={i}
            className="bg-shape"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              border: "3px solid var(--border)",
              borderRadius: s.kind === "circle" ? "999px" : 0,
              animationDuration: s.dur,
              animationDelay: s.delay,
            }}
          />
        );
      })}
    </>
  );
}
