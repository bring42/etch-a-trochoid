import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildGear,
  buildTrochoid,
  clamp,
  DEG,
  fraction,
  gcd,
  type GearKind,
  type GearParams,
  planetCenter,
  planetPenHolePositions,
  planetRotation,
  pointsToPath,
  runGearMathSelfTest,
  type TrochoidMode,
} from "./gear-math";
import { downloadText, exportSingleGearSvg, exportSpirographKitSvg } from "./svg-export";
import { downloadBlob, exportGearStl } from "./stl-export";

if (typeof window !== "undefined" && !(window as unknown as { __EAG_TESTS__?: boolean }).__EAG_TESTS__) {
  (window as unknown as { __EAG_TESTS__?: boolean }).__EAG_TESTS__ = true;
  const result = runGearMathSelfTest();
  if (result.failed > 0) {
    console.error(`[etch-a-gear] gear-math self-test FAILED: ${result.failed} failures`, result.failures);
  } else {
    console.log(`[etch-a-gear] gear-math self-test ok (${result.passed} checks).`);
  }
}

const ACCENT = "#1d4ed8";
const HOT = "#ff3b30";
const PAPER = "#f7f5ef";
const INK = "#09090b";
const PALETTE = [ACCENT, HOT, "#111827", "#6d28d9", "#0f766e", "#be123c"];

type Mode = "spirograph" | "designer";

const DEFAULT_EXTERNAL: GearParams = {
  kind: "external",
  teeth: 24,
  module: 2,
  pressureAngle: 20 * DEG,
  profileShift: 0,
  addendumCoef: 1,
  dedendumCoef: 1.25,
  boreDiameter: 5,
};

const DEFAULT_INTERNAL: GearParams = {
  kind: "internal",
  teeth: 96,
  module: 2,
  pressureAngle: 20 * DEG,
  profileShift: 0,
  addendumCoef: 1,
  dedendumCoef: 1.25,
  boreDiameter: 0,
};

type SpiroPreset = {
  label: string;
  ringTeeth: number;
  planetTeeth: number;
  penOffset: number;
  mode: TrochoidMode;
  ink: string;
};

const PRESETS: SpiroPreset[] = [
  { label: "Star", ringTeeth: 96, planetTeeth: 36, penOffset: 0.72, mode: "inside", ink: ACCENT },
  { label: "Web", ringTeeth: 84, planetTeeth: 35, penOffset: 0.58, mode: "inside", ink: HOT },
  { label: "Bloom", ringTeeth: 105, planetTeeth: 45, penOffset: 0.82, mode: "inside", ink: "#111827" },
  { label: "Spiral", ringTeeth: 90, planetTeeth: 20, penOffset: 0.68, mode: "inside", ink: "#6d28d9" },
  { label: "Ring", ringTeeth: 72, planetTeeth: 24, penOffset: 0.48, mode: "outside", ink: "#0f766e" },
  { label: "Wheel", ringTeeth: 120, planetTeeth: 32, penOffset: 0.9, mode: "inside", ink: "#be123c" },
];

// ---------- shared UI atoms ----------

function MicroLabel({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">{children}</div>;
}

function Pill({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-3 py-1.5 font-mono text-[11px] font-black uppercase tracking-[0.12em] transition ${
        active
          ? "border-zinc-950 bg-zinc-950 text-white"
          : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-950"
      }`}
    >
      {children}
    </button>
  );
}

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
  format?: (v: number) => string;
  compact?: boolean;
};

function Slider({ label, value, min, max, step, onChange, suffix = "", format, compact = false }: SliderProps) {
  return (
    <label className={`grid gap-1 ${compact ? "" : "border-t border-zinc-200 pt-2"}`}>
      <span className="flex items-center justify-between gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
        <span>{label}</span>
        <span className="text-zinc-950">
          {format ? format(value) : value}
          {suffix}
        </span>
      </span>
      <input
        className="h-1.5 w-full appearance-none rounded-none bg-zinc-300 accent-zinc-950"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

// ---------- Spirograph (the playground) ----------

const CURVE_SAMPLES = 4000;
const ANIMATION_BASE_DURATION_MS = 5200;

function Spirograph({ onOpenDesigner }: { onOpenDesigner: () => void }) {
  // essentials
  const [mode, setMode] = useState<TrochoidMode>("inside");
  const [ringTeeth, setRingTeeth] = useState(96);
  const [planetTeeth, setPlanetTeeth] = useState(36);
  const [penOffset, setPenOffset] = useState(0.72);
  const [inkColor, setInkColor] = useState(ACCENT);
  const [animate, setAnimate] = useState(true);
  const [showMechanism, setShowMechanism] = useState(false); // the discovery!
  // advanced
  const [moduleMm, setModuleMm] = useState(2);
  const [boreMm, setBoreMm] = useState(5);
  const [penHoles, setPenHoles] = useState(8);
  const [phase, setPhase] = useState(0);
  const [animationSpeed, setAnimationSpeed] = useState(60);
  const [thicknessMm, setThicknessMm] = useState(3);
  const [clearanceMm, setClearanceMm] = useState(0.15);
  // ui state
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!animate) {
      setProgress(1);
      return undefined;
    }
    let frame = 0;
    let start = 0;
    const speedMult = Math.max(animationSpeed / 100, 0.1);
    const duration = ANIMATION_BASE_DURATION_MS / speedMult;
    const tick = (ts: number) => {
      if (start === 0) start = ts;
      const elapsed = ts - start;
      const loop = (elapsed % duration) / duration;
      setProgress(clamp(loop, 0.015, 1));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, animationSpeed]);

  useEffect(() => {
    if (mode === "inside" && planetTeeth >= ringTeeth) {
      setPlanetTeeth(Math.max(8, ringTeeth - 4));
    }
  }, [mode, ringTeeth, planetTeeth]);

  const trochoid = useMemo(
    () =>
      buildTrochoid({
        ringTeeth,
        planetTeeth,
        module: moduleMm,
        penOffsetFraction: penOffset,
        mode,
        phase,
        samples: CURVE_SAMPLES,
      }),
    [ringTeeth, planetTeeth, moduleMm, penOffset, mode, phase],
  );

  const ringGeom = useMemo(
    () =>
      buildGear({
        kind: mode === "inside" ? "internal" : "external",
        teeth: ringTeeth,
        module: moduleMm,
        pressureAngle: 20 * DEG,
        profileShift: 0,
        addendumCoef: 1,
        dedendumCoef: 1.25,
        boreDiameter: mode === "outside" ? boreMm : 0,
      }),
    [ringTeeth, moduleMm, mode, boreMm],
  );

  const planetGeom = useMemo(
    () =>
      buildGear({
        kind: "external",
        teeth: planetTeeth,
        module: moduleMm,
        pressureAngle: 20 * DEG,
        profileShift: 0,
        addendumCoef: 1,
        dedendumCoef: 1.25,
        boreDiameter: boreMm,
      }),
    [planetTeeth, moduleMm, boreMm],
  );

  const reduced = fraction(ringTeeth, planetTeeth);
  const closure = planetTeeth / gcd(ringTeeth, planetTeeth);

  const visibleIndex = Math.max(1, Math.min(CURVE_SAMPLES, Math.round(progress * CURVE_SAMPLES)));
  const visiblePoints = trochoid.points.slice(0, visibleIndex + 1);
  const fullPath = pointsToPath(trochoid.points);
  const visiblePath = pointsToPath(visiblePoints);
  const t = trochoid.maxT * (visibleIndex / CURVE_SAMPLES) + phase;
  const center = planetCenter(trochoid.R, trochoid.r, mode, t);
  const spin = planetRotation(trochoid.R, trochoid.r, mode, t) + Math.PI / planetTeeth;
  const penPoint = visiblePoints[visiblePoints.length - 1] ?? trochoid.points[0];

  const ringRadiusOuter = mode === "inside" ? ringGeom.rimRadius : trochoid.R + planetGeom.rimRadius * 2 + 8;
  const viewBoxMm = ringRadiusOuter * 2 + 16;

  const planetProfile = planetGeom.outerProfile.map((p) => {
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    return { x: center.x + p.x * c - p.y * s, y: center.y + p.x * s + p.y * c };
  });
  const planetPath = pointsToPath(planetProfile, true);
  const ringPath = pointsToPath(ringGeom.outerProfile, true);

  function applyPreset(p: SpiroPreset) {
    setRingTeeth(p.ringTeeth);
    setPlanetTeeth(p.planetTeeth);
    setPenOffset(p.penOffset);
    setMode(p.mode);
    setInkColor(p.ink);
    setProgress(1);
  }

  function exportDrawing() {
    const margin = 4;
    const size = ringRadiusOuter * 2 + margin * 2;
    const cx = size / 2;
    const cy = size / 2;
    const pathShifted = pointsToPath(trochoid.points.map((p) => ({ x: p.x + cx, y: p.y + cy })));
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${size}mm" height="${size}mm" viewBox="0 0 ${size} ${size}">\n  <rect width="${size}" height="${size}" fill="white"/>\n  <path d="${pathShifted}" fill="none" stroke="${inkColor}" stroke-width="0.4" stroke-linecap="round" stroke-linejoin="round"/>\n  <text x="${margin}" y="${size - margin}" font-family="monospace" font-size="3" fill="black">spirograph ${ringTeeth}/${planetTeeth} pen ${(penOffset * 100).toFixed(0)}%</text>\n</svg>\n`;
    downloadText(`spirograph-drawing-${ringTeeth}-${planetTeeth}-pen${Math.round(penOffset * 100)}.svg`, svg);
    setExportOpen(false);
  }

  function exportKitSvg() {
    const svg = exportSpirographKitSvg({
      ring: ringGeom,
      planet: planetGeom,
      penHoleCount: penHoles,
      penHoleDiameter: 1.5,
      pageWidthMm: 297,
      pageHeightMm: 210,
    });
    downloadText(`spirograph-kit-${ringTeeth}-${planetTeeth}-m${moduleMm}.svg`, svg);
    setExportOpen(false);
  }

  function exportRingStl() {
    const tag = `${ringGeom.params.kind === "internal" ? "ring" : "sun"}-z${ringTeeth}-m${moduleMm}-t${thicknessMm}mm`;
    downloadBlob(`spiro-${tag}.stl`, exportGearStl(ringGeom, { thicknessMm, clearanceMm }));
  }

  function exportPlanetStl() {
    const tag = `planet-z${planetTeeth}-m${moduleMm}-t${thicknessMm}mm`;
    const holes = planetPenHolePositions(planetGeom, penHoles, 1.5);
    downloadBlob(`spiro-${tag}.stl`, exportGearStl(planetGeom, { thicknessMm, clearanceMm, penHoles: holes }));
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto] gap-2">
      {/* CANVAS — dominates the screen */}
      <section className="relative min-h-0 border border-zinc-950 bg-[#f7f5ef] shadow-[10px_10px_0_#09090b]">
        <svg
          id="spiro-svg"
          viewBox={`${-viewBoxMm / 2} ${-viewBoxMm / 2} ${viewBoxMm} ${viewBoxMm}`}
          className="h-full w-full"
          role="img"
          aria-label="Spirograph preview"
        >
          <rect x={-viewBoxMm / 2} y={-viewBoxMm / 2} width={viewBoxMm} height={viewBoxMm} fill={PAPER} />
          {/* Subtle radial guides */}
          <g opacity="0.32">
            {Array.from({ length: 6 }).map((_, i) => (
              <circle
                key={i}
                cx={0}
                cy={0}
                r={trochoid.R * (0.2 + i * 0.16)}
                fill="none"
                stroke="#c9c5ba"
                strokeWidth="0.15"
                strokeDasharray="0.6 1.2"
              />
            ))}
          </g>

          {showMechanism && (
            <g>
              {ringGeom.rimCircleRadius !== null && (
                <circle cx={0} cy={0} r={ringGeom.rimCircleRadius} fill="none" stroke={INK} strokeWidth="0.5" />
              )}
              <path
                d={ringPath}
                fill={mode === "outside" ? "rgba(9,9,11,0.04)" : "none"}
                stroke={INK}
                strokeWidth="0.35"
                strokeLinejoin="miter"
              />
              {mode === "outside" && (
                <circle cx={0} cy={0} r={Math.max(0.6, boreMm / 2)} fill="none" stroke={INK} strokeWidth="0.25" />
              )}
              <path d={planetPath} fill="rgba(255,255,255,0.6)" stroke={INK} strokeWidth="0.35" strokeLinejoin="miter" />
              <circle
                cx={center.x}
                cy={center.y}
                r={Math.max(0.6, planetGeom.params.boreDiameter / 2)}
                fill="none"
                stroke={INK}
                strokeWidth="0.25"
              />
              <line x1={center.x} y1={center.y} x2={penPoint.x} y2={penPoint.y} stroke={INK} strokeWidth="0.4" />
              <circle cx={penPoint.x} cy={penPoint.y} r={Math.max(0.5, moduleMm * 0.4)} fill={HOT} stroke={INK} strokeWidth="0.2" />
            </g>
          )}

          <path d={fullPath} fill="none" stroke={inkColor} strokeOpacity="0.12" strokeWidth="0.3" />
          <path d={visiblePath} fill="none" stroke={inkColor} strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round" />

          <g transform={`translate(${-viewBoxMm / 2 + 3} ${-viewBoxMm / 2 + 4})`}>
            <text fontFamily="ui-monospace, monospace" fontSize="2.4" fontWeight="800" letterSpacing="0.4" fill="#52525b">
              ETCH-A-GEAR
            </text>
            <text y="4.5" fontFamily="ui-monospace, monospace" fontSize="3" fontWeight="900" letterSpacing="0.2" fill={INK}>
              {ringTeeth}:{planetTeeth} · {reduced} · {closure} loop{closure === 1 ? "" : "s"}
            </text>
          </g>
          <g transform={`translate(${-viewBoxMm / 2 + 4} ${viewBoxMm / 2 - 4})`}>
            <line x1={0} y1={0} x2={20} y2={0} stroke={INK} strokeWidth="0.3" />
            <line x1={0} y1={-0.8} x2={0} y2={0.8} stroke={INK} strokeWidth="0.3" />
            <line x1={20} y1={-0.8} x2={20} y2={0.8} stroke={INK} strokeWidth="0.3" />
            <text x={10} y={-1.4} textAnchor="middle" fontFamily="monospace" fontSize="2" fill={INK}>
              20 mm
            </text>
          </g>
        </svg>

        {/* Floating discovery & action buttons over the canvas */}
        <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => setShowMechanism((v) => !v)}
            className={`pointer-events-auto border px-3 py-2 font-mono text-[11px] font-black uppercase tracking-[0.12em] shadow-[3px_3px_0_#09090b] transition ${
              showMechanism
                ? "border-zinc-950 bg-zinc-950 text-white"
                : "border-zinc-950 bg-white text-zinc-950 hover:bg-zinc-50"
            }`}
            title={showMechanism ? "Hide the gears" : "Show the gears that draw this"}
          >
            {showMechanism ? "Hide gears" : "Show gears →"}
          </button>
        </div>

        {/* Bottom-floating animate toggle */}
        <button
          type="button"
          onClick={() => setAnimate((v) => !v)}
          className="absolute bottom-3 right-3 border border-zinc-950 bg-white px-3 py-2 font-mono text-[11px] font-black uppercase tracking-[0.12em] shadow-[3px_3px_0_#09090b] hover:bg-zinc-50"
        >
          {animate ? "Pause" : "Animate"}
        </button>
      </section>

      {/* CONTROLS STRIP */}
      <section className="border border-zinc-950 bg-[#fbfaf7] shadow-[8px_8px_0_#09090b]">
        <div className="grid gap-3 p-3 lg:p-4">
          {/* Top row: presets + mode + advanced + export */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <MicroLabel>Try</MicroLabel>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] font-black uppercase tracking-[0.1em] text-zinc-700 hover:border-zinc-950 hover:bg-zinc-950 hover:text-white"
                  style={{ borderLeftColor: p.ink, borderLeftWidth: 4 }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Pill active={mode === "inside"} onClick={() => setMode("inside")}>
                inside
              </Pill>
              <Pill active={mode === "outside"} onClick={() => setMode("outside")}>
                outside
              </Pill>
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="border border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-[12px] font-black uppercase tracking-[0.14em] text-white shadow-[3px_3px_0_#ff3b30] hover:bg-zinc-800"
              >
                Export
              </button>
            </div>
          </div>

          {/* Three sliders + color */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Slider
              label="Big gear"
              value={ringTeeth}
              min={32}
              max={200}
              step={1}
              onChange={setRingTeeth}
              compact
            />
            <Slider
              label="Small gear"
              value={planetTeeth}
              min={6}
              max={Math.max(8, mode === "inside" ? ringTeeth - 4 : 120)}
              step={1}
              onChange={setPlanetTeeth}
              compact
            />
            <Slider
              label="Pen position"
              value={Math.round(penOffset * 100)}
              min={5}
              max={100}
              step={1}
              suffix="%"
              onChange={(v) => setPenOffset(v / 100)}
              compact
            />
          </div>
          <div className="flex items-center gap-3">
            <MicroLabel>Color</MicroLabel>
            <div className="flex gap-1.5">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Set ink ${c}`}
                  onClick={() => setInkColor(c)}
                  className={`h-7 w-7 border ${inkColor === c ? "border-zinc-950 ring-2 ring-zinc-950" : "border-zinc-300"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 underline-offset-4 hover:text-zinc-950 hover:underline"
              >
                {advancedOpen ? "Hide advanced ▴" : "Advanced ▾"}
              </button>
              <button
                type="button"
                onClick={onOpenDesigner}
                className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 underline-offset-4 hover:text-zinc-950 hover:underline"
              >
                Build a custom gear →
              </button>
            </div>
          </div>

          {advancedOpen && (
            <div className="grid gap-3 border-t border-zinc-300 pt-3">
              <MicroLabel>Advanced — for power users</MicroLabel>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Slider
                  label="Module"
                  value={moduleMm}
                  min={0.5}
                  max={5}
                  step={0.1}
                  suffix=" mm"
                  format={(v) => v.toFixed(1)}
                  onChange={setModuleMm}
                  compact
                />
                <Slider
                  label="Bore (axle hole)"
                  value={boreMm}
                  min={0}
                  max={20}
                  step={0.5}
                  suffix=" mm"
                  format={(v) => v.toFixed(1)}
                  onChange={setBoreMm}
                  compact
                />
                <Slider
                  label="Pen holes"
                  value={penHoles}
                  min={1}
                  max={16}
                  step={1}
                  onChange={setPenHoles}
                  compact
                />
                <Slider
                  label="Phase"
                  value={Math.round((phase * 180) / Math.PI)}
                  min={0}
                  max={360}
                  step={1}
                  suffix="°"
                  onChange={(v) => setPhase((v * Math.PI) / 180)}
                  compact
                />
                {animate ? (
                  <Slider
                    label="Animation speed"
                    value={animationSpeed}
                    min={20}
                    max={400}
                    step={5}
                    suffix="%"
                    onChange={setAnimationSpeed}
                    compact
                  />
                ) : (
                  <Slider
                    label="Draw progress"
                    value={Math.round(progress * 100)}
                    min={1}
                    max={100}
                    step={1}
                    suffix="%"
                    onChange={(v) => setProgress(v / 100)}
                    compact
                  />
                )}
                <Slider
                  label="3D thickness"
                  value={thicknessMm}
                  min={0.5}
                  max={20}
                  step={0.5}
                  suffix=" mm"
                  format={(v) => v.toFixed(1)}
                  onChange={setThicknessMm}
                  compact
                />
                <Slider
                  label="3D clearance"
                  value={clearanceMm}
                  min={0}
                  max={0.5}
                  step={0.05}
                  suffix=" mm"
                  format={(v) => v.toFixed(2)}
                  onChange={setClearanceMm}
                  compact
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* EXPORT POPUP */}
      {exportOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 p-4"
          onClick={() => setExportOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md border border-zinc-950 bg-[#fbfaf7] shadow-[12px_12px_0_#09090b]"
          >
            <div className="grid gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <MicroLabel>export</MicroLabel>
                  <h3 className="mt-1 text-2xl font-black uppercase leading-none tracking-[-0.05em]">
                    Take it offline
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setExportOpen(false)}
                  className="border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] font-black"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <ExportRow
                title="Drawing"
                desc="The pattern as a vector SVG. Open in any browser, share, or print."
                action="Save SVG"
                onClick={exportDrawing}
              />
              <ExportRow
                title="Paper kit"
                desc="Ring + planet on A4 with all the pen holes marked. Print at 100%, cut out, push pen, draw."
                action="Save SVG"
                onClick={exportKitSvg}
              />

              <div className="border-t border-zinc-300 pt-3">
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                  3D printable kit
                </div>
                <p className="mt-1 font-mono text-[11px] leading-5 text-zinc-700">
                  Real involute gears with pen holes built in. Two STL files, ready for any slicer.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={exportRingStl}
                    className="border border-zinc-950 bg-white px-3 py-2 font-mono text-[11px] font-black uppercase tracking-[0.12em] text-zinc-950 hover:bg-zinc-100"
                  >
                    {mode === "inside" ? "Ring" : "Sun"} STL
                  </button>
                  <button
                    type="button"
                    onClick={exportPlanetStl}
                    className="border border-zinc-950 bg-white px-3 py-2 font-mono text-[11px] font-black uppercase tracking-[0.12em] text-zinc-950 hover:bg-zinc-100"
                  >
                    Planet STL
                  </button>
                </div>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                  Thickness {thicknessMm.toFixed(1)} mm · clearance {clearanceMm.toFixed(2)} mm (adjust in Advanced)
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExportRow({ title, desc, action, onClick }: { title: string; desc: string; action: string; onClick: () => void }) {
  return (
    <div className="flex items-start gap-3 border-t border-zinc-300 pt-3">
      <div className="grow">
        <div className="font-mono text-xs font-black uppercase tracking-[0.12em]">{title}</div>
        <p className="mt-0.5 font-mono text-[11px] leading-5 text-zinc-600">{desc}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="shrink-0 border border-zinc-950 bg-zinc-950 px-3 py-2 font-mono text-[11px] font-black uppercase tracking-[0.12em] text-white hover:bg-zinc-800"
      >
        {action}
      </button>
    </div>
  );
}

// ---------- Gear Designer (secondary mode) ----------

function GearDesigner({ onBack }: { onBack: () => void }) {
  const [params, setParams] = useState<GearParams>(DEFAULT_EXTERNAL);
  const [exportOpen, setExportOpen] = useState(false);
  const [thicknessMm, setThicknessMm] = useState(3);
  const [clearanceMm, setClearanceMm] = useState(0.15);

  const geometry = useMemo(() => buildGear(params), [params]);

  function update<K extends keyof GearParams>(key: K, value: GearParams[K]) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  function setKind(kind: GearKind) {
    setParams(kind === "external" ? DEFAULT_EXTERNAL : DEFAULT_INTERNAL);
  }

  const viewSizeMm = geometry.rimRadius * 2 + 12;
  const path = pointsToPath(geometry.outerProfile, true);
  const pitchPath = circleSvg(geometry.pitchRadius);
  const basePath = circleSvg(geometry.baseRadius);
  const tipPath = circleSvg(geometry.outsideRadius);
  const rootPath = circleSvg(geometry.rootRadius);

  function exportSvgNow() {
    const tag = `${geometry.params.kind === "internal" ? "ring" : "gear"}-z${geometry.params.teeth}-m${geometry.params.module}mm`;
    downloadText(`${tag}.svg`, exportSingleGearSvg(geometry));
    setExportOpen(false);
  }
  function exportStlNow() {
    const tag = `${geometry.params.kind === "internal" ? "ring" : "gear"}-z${geometry.params.teeth}-m${geometry.params.module}mm-t${thicknessMm}mm`;
    downloadBlob(`${tag}.stl`, exportGearStl(geometry, { thicknessMm, clearanceMm }));
    setExportOpen(false);
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto] gap-2">
      <section className="relative min-h-0 border border-zinc-950 bg-[#f7f5ef] shadow-[10px_10px_0_#09090b]">
        <svg
          viewBox={`${-viewSizeMm / 2} ${-viewSizeMm / 2} ${viewSizeMm} ${viewSizeMm}`}
          className="h-full w-full"
          role="img"
          aria-label="Gear preview"
        >
          <defs>
            <pattern id="mmGrid" width="1" height="1" patternUnits="userSpaceOnUse" x={-viewSizeMm / 2} y={-viewSizeMm / 2}>
              <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#d8d5cc" strokeWidth="0.04" />
            </pattern>
            <pattern id="mmGrid10" width="10" height="10" patternUnits="userSpaceOnUse" x={-viewSizeMm / 2} y={-viewSizeMm / 2}>
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#bfbcb1" strokeWidth="0.1" />
            </pattern>
          </defs>
          <rect x={-viewSizeMm / 2} y={-viewSizeMm / 2} width={viewSizeMm} height={viewSizeMm} fill={PAPER} />
          <rect x={-viewSizeMm / 2} y={-viewSizeMm / 2} width={viewSizeMm} height={viewSizeMm} fill="url(#mmGrid)" />
          <rect x={-viewSizeMm / 2} y={-viewSizeMm / 2} width={viewSizeMm} height={viewSizeMm} fill="url(#mmGrid10)" />
          <path d={pitchPath} fill="none" stroke={ACCENT} strokeWidth="0.18" strokeDasharray="0.8 0.6" />
          <path d={basePath} fill="none" stroke="#a1a1aa" strokeWidth="0.12" strokeDasharray="0.4 0.6" />
          <path d={tipPath} fill="none" stroke="#a1a1aa" strokeWidth="0.08" />
          <path d={rootPath} fill="none" stroke="#a1a1aa" strokeWidth="0.08" />
          {geometry.rimCircleRadius !== null && (
            <circle cx={0} cy={0} r={geometry.rimCircleRadius} fill="none" stroke={INK} strokeWidth="0.25" />
          )}
          <path
            d={path}
            fill={geometry.params.kind === "internal" ? "#ffffff" : "rgba(9,9,11,0.04)"}
            stroke={INK}
            strokeWidth="0.25"
            strokeLinejoin="miter"
          />
          {params.boreDiameter > 0 && (
            <>
              <circle cx={0} cy={0} r={params.boreDiameter / 2} fill="white" stroke={INK} strokeWidth="0.2" />
              <line x1={-1.5} y1={0} x2={1.5} y2={0} stroke={INK} strokeWidth="0.1" />
              <line x1={0} y1={-1.5} x2={0} y2={1.5} stroke={INK} strokeWidth="0.1" />
            </>
          )}
          <g transform={`translate(${-viewSizeMm / 2 + 4} ${viewSizeMm / 2 - 4})`}>
            <line x1={0} y1={0} x2={10} y2={0} stroke={INK} strokeWidth="0.3" />
            <line x1={0} y1={-0.8} x2={0} y2={0.8} stroke={INK} strokeWidth="0.3" />
            <line x1={10} y1={-0.8} x2={10} y2={0.8} stroke={INK} strokeWidth="0.3" />
            <text x={5} y={-1.4} textAnchor="middle" fontFamily="monospace" fontSize="2" fill={INK}>
              10 mm
            </text>
          </g>
        </svg>
        <button
          type="button"
          onClick={onBack}
          className="absolute left-3 top-3 border border-zinc-950 bg-white px-3 py-2 font-mono text-[11px] font-black uppercase tracking-[0.12em] shadow-[3px_3px_0_#09090b] hover:bg-zinc-50"
        >
          ← back to spirograph
        </button>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="absolute right-3 top-3 border border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-[12px] font-black uppercase tracking-[0.14em] text-white shadow-[3px_3px_0_#ff3b30] hover:bg-zinc-800"
        >
          Export
        </button>
      </section>

      <section className="border border-zinc-950 bg-[#fbfaf7] shadow-[8px_8px_0_#09090b]">
        <div className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <MicroLabel>Gear designer</MicroLabel>
              <h2 className="mt-1 text-xl font-black uppercase leading-none tracking-[-0.05em]">Build a gear</h2>
            </div>
            <div className="flex gap-2">
              <Pill active={params.kind === "external"} onClick={() => setKind("external")}>
                external
              </Pill>
              <Pill active={params.kind === "internal"} onClick={() => setKind("internal")}>
                internal (ring)
              </Pill>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-zinc-300 pt-3 font-mono text-[11px] font-bold uppercase tracking-[0.10em] sm:grid-cols-4">
            <Stat label="pitch ⌀" value={`${(geometry.pitchRadius * 2).toFixed(2)} mm`} />
            <Stat label="base ⌀" value={`${(geometry.baseRadius * 2).toFixed(2)} mm`} />
            <Stat label="tip ⌀" value={`${(geometry.outsideRadius * 2).toFixed(2)} mm`} />
            <Stat label="root ⌀" value={`${(geometry.rootRadius * 2).toFixed(2)} mm`} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Slider
              label="Teeth"
              value={params.teeth}
              min={params.kind === "internal" ? 24 : 6}
              max={240}
              step={1}
              onChange={(v) => update("teeth", v)}
              compact
            />
            <Slider
              label="Module"
              value={params.module}
              min={0.5}
              max={5}
              step={0.1}
              suffix=" mm"
              format={(v) => v.toFixed(1)}
              onChange={(v) => update("module", v)}
              compact
            />
            <Slider
              label="Bore"
              value={params.boreDiameter}
              min={0}
              max={Math.max(20, geometry.pitchRadius)}
              step={0.5}
              suffix=" mm"
              format={(v) => v.toFixed(1)}
              onChange={(v) => update("boreDiameter", v)}
              compact
            />
            <Slider
              label="Pressure angle"
              value={Math.round((params.pressureAngle / DEG) * 10) / 10}
              min={14.5}
              max={25}
              step={0.5}
              suffix="°"
              onChange={(v) => update("pressureAngle", v * DEG)}
              compact
            />
            <Slider
              label="Profile shift x"
              value={Math.round(params.profileShift * 100) / 100}
              min={-0.5}
              max={0.5}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => update("profileShift", v)}
              compact
            />
            <Slider
              label="Addendum ha"
              value={Math.round(params.addendumCoef * 100) / 100}
              min={0.5}
              max={1.5}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => update("addendumCoef", v)}
              compact
            />
            <Slider
              label="Dedendum hf"
              value={Math.round(params.dedendumCoef * 100) / 100}
              min={1.0}
              max={1.6}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => update("dedendumCoef", v)}
              compact
            />
            <Slider
              label="3D thickness"
              value={thicknessMm}
              min={0.5}
              max={20}
              step={0.5}
              suffix=" mm"
              format={(v) => v.toFixed(1)}
              onChange={setThicknessMm}
              compact
            />
            <Slider
              label="3D clearance"
              value={clearanceMm}
              min={0}
              max={0.5}
              step={0.05}
              suffix=" mm"
              format={(v) => v.toFixed(2)}
              onChange={setClearanceMm}
              compact
            />
          </div>
          {geometry.warnings.length > 0 && (
            <div className="border border-[#ff3b30] bg-[#fff6f5] p-2 font-mono text-[10px] font-bold uppercase tracking-wide text-[#ff3b30]">
              {geometry.warnings.join("  ·  ")}
            </div>
          )}
        </div>
      </section>

      {exportOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 p-4" onClick={() => setExportOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md border border-zinc-950 bg-[#fbfaf7] shadow-[12px_12px_0_#09090b]"
          >
            <div className="grid gap-4 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <MicroLabel>export</MicroLabel>
                  <h3 className="mt-1 text-2xl font-black uppercase leading-none tracking-[-0.05em]">Save your gear</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setExportOpen(false)}
                  className="border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] font-black"
                >
                  ×
                </button>
              </div>
              <ExportRow title="2D vector" desc="SVG with real mm units. Print at 100% to laser-cut." action="Save SVG" onClick={exportSvgNow} />
              <ExportRow
                title="3D printable"
                desc={`STL at ${thicknessMm.toFixed(1)} mm thick · ${clearanceMm.toFixed(2)} mm clearance.`}
                action="Save STL"
                onClick={exportStlNow}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-zinc-500">{label}</div>
      <div className="text-zinc-950">{value}</div>
    </div>
  );
}

function circleSvg(r: number): string {
  if (r <= 0) return "";
  return `M ${(-r).toFixed(4)} 0 A ${r.toFixed(4)} ${r.toFixed(4)} 0 1 0 ${r.toFixed(4)} 0 A ${r.toFixed(4)} ${r.toFixed(4)} 0 1 0 ${(-r).toFixed(4)} 0 Z`;
}

// ---------- root ----------

export default function App() {
  const [mode, setMode] = useState<Mode>("spirograph");

  return (
    <main className="h-screen overflow-hidden bg-[#ece8df] text-zinc-950">
      <div className="mx-auto grid h-full w-full max-w-[1500px] grid-rows-[auto_1fr] gap-2 p-3 lg:p-4">
        <header className="flex items-center justify-between gap-4 border border-zinc-950 bg-zinc-950 px-4 py-2 text-white shadow-[6px_6px_0_#ff3b30]">
          <div>
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-zinc-400">
              spirograph playground · printable gears
            </div>
            <h1 className="text-xl font-black uppercase leading-none tracking-[-0.05em] sm:text-2xl">Etch-a-Gear</h1>
          </div>
          {mode === "designer" && (
            <button
              type="button"
              onClick={() => setMode("spirograph")}
              className="border border-white/40 bg-zinc-900 px-3 py-1.5 font-mono text-[11px] font-black uppercase tracking-[0.12em] text-white hover:bg-zinc-800"
            >
              ← spirograph
            </button>
          )}
        </header>
        <div className="min-h-0">
          {mode === "spirograph" ? (
            <Spirograph onOpenDesigner={() => setMode("designer")} />
          ) : (
            <GearDesigner onBack={() => setMode("spirograph")} />
          )}
        </div>
      </div>
    </main>
  );
}
