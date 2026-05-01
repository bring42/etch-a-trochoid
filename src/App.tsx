import { useEffect, useMemo, useState, type ReactNode } from "react";

type TrochoidMode = "inside" | "outside";

type Point = {
  x: number;
  y: number;
};

type Preset = {
  label: string;
  ring: number;
  gear: number;
  offset: number;
  mode: TrochoidMode;
  ink: string;
};

type CurveInput = {
  ringTeeth: number;
  gearTeeth: number;
  penOffset: number;
  mode: TrochoidMode;
  phase: number;
  width: number;
  height: number;
  samples: number;
};

type CurveResult = {
  points: Point[];
  R: number;
  r: number;
  d: number;
  loops: number;
  maxT: number;
  scale: number;
  cx: number;
  cy: number;
};

type BuildMechanismInput = {
  ringTeeth: number;
  gearTeeth: number;
  mode: TrochoidMode;
  penOffset: number;
};

type GearBoundaryInput = {
  teeth: number;
  cx: number;
  cy: number;
  pitchRadius: number;
  startAngle?: number;
  internal?: boolean;
  pressureAngleDeg?: number;
  backlashFactor?: number;
  addendumFactor?: number;
  dedendumFactor?: number;
};

type RangeControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
};

type ToggleButtonProps = {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
};

type SpiroArtboardProps = {
  ringTeeth: number;
  gearTeeth: number;
  penOffset: number;
  mode: TrochoidMode;
  phase: number;
  progress: number;
  showMechanism: boolean;
  showTeeth: boolean;
  inkColor: string;
};

const CURVE_SAMPLES = 3000;
const MECHANISM_PHASE_OFFSET = -Math.PI / 2;
const ANIMATION_BASE_DURATION_MS = 5200;
const EXPORT_PRESSURE_ANGLE_DEG = 20;
const EXPORT_BACKLASH_FACTOR = 0.18;
const EXPORT_RING_WALL_FACTOR = 5.5;

const ACCENT = "#1d4ed8";
const HOT = "#ff3b30";
const PAPER = "#f7f5ef";
const INK = "#09090b";

const PRESETS: Preset[] = [
  { label: "96/36", ring: 96, gear: 36, offset: 0.72, mode: "inside", ink: ACCENT },
  { label: "84/35", ring: 84, gear: 35, offset: 0.58, mode: "inside", ink: HOT },
  { label: "105/45", ring: 105, gear: 45, offset: 0.82, mode: "inside", ink: "#111827" },
  { label: "90/20", ring: 90, gear: 20, offset: 0.68, mode: "inside", ink: "#6d28d9" },
  { label: "72/24", ring: 72, gear: 24, offset: 0.48, mode: "outside", ink: "#0f766e" },
  { label: "120/32", ring: 120, gear: 32, offset: 0.9, mode: "inside", ink: "#be123c" },
];

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));

  while (y !== 0) {
    const temp = y;
    y = x % y;
    x = temp;
  }

  return x || 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function fraction(a: number, b: number): string {
  const divisor = gcd(a, b);
  return `${a / divisor}:${b / divisor}`;
}

function polar(cx: number, cy: number, radius: number, angle: number): Point {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function pointsToPath(points: Point[]): string {
  if (!points.length) {
    return "";
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function hypotrochoidPoint(R: number, r: number, d: number, t: number): Point {
  return {
    x: (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t),
    y: (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t),
  };
}

function epitrochoidPoint(R: number, r: number, d: number, t: number): Point {
  return {
    x: (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t),
    y: (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t),
  };
}

function buildCurve({ ringTeeth, gearTeeth, penOffset, mode, phase, width, height, samples }: CurveInput): CurveResult {
  const cx = width / 2;
  const cy = height / 2;
  const R = ringTeeth;
  const r = gearTeeth;
  const d = penOffset * r;
  const common = gcd(R, r);
  const loops = r / common;
  const maxT = Math.PI * 2 * loops;

  const raw: Point[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = (index / samples) * maxT + phase;
    raw.push(mode === "inside" ? hypotrochoidPoint(R, r, d, t) : epitrochoidPoint(R, r, d, t));
  }

  const maxAbs = raw.reduce((currentMax, point) => Math.max(currentMax, Math.abs(point.x), Math.abs(point.y)), 1);
  const scale = (Math.min(width, height) * 0.375) / maxAbs;
  const points = raw.map((point) => ({ x: cx + point.x * scale, y: cy + point.y * scale }));

  return { points, R, r, d, loops, maxT, scale, cx, cy };
}

function gearPath(
  teeth: number,
  cx: number,
  cy: number,
  pitchRadius: number,
  toothDepth = 0.15,
  rootBias = 0.04,
  startAngle = -Math.PI / 2,
): string {
  const steps = Math.max(8, teeth * 2);
  const root = pitchRadius * (1 - toothDepth - rootBias);
  const tip = pitchRadius * (1 + toothDepth);
  const points: Point[] = [];

  for (let index = 0; index < steps; index += 1) {
    const angle = startAngle + (index / steps) * Math.PI * 2;
    const radius = index % 2 === 0 ? tip : root;
    points.push(polar(cx, cy, radius, angle));
  }

  return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")} Z`;
}

function innerRingTeethPath(
  teeth: number,
  cx: number,
  cy: number,
  innerRadius: number,
  toothDepth = 0.08,
  startAngle = -Math.PI / 2,
): string {
  const steps = Math.max(8, teeth * 2);
  const valley = innerRadius * (1 - toothDepth);
  const crown = innerRadius * (1 + toothDepth * 0.4);
  const points: Point[] = [];

  for (let index = 0; index < steps; index += 1) {
    const angle = startAngle + (index / steps) * Math.PI * 2;
    const radius = index % 2 === 0 ? crown : valley;
    points.push(polar(cx, cy, radius, angle));
  }

  return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")} Z`;
}

function outerRingTeethPath(
  teeth: number,
  cx: number,
  cy: number,
  outerRadius: number,
  toothDepth = 0.08,
  startAngle = -Math.PI / 2,
): string {
  const steps = Math.max(8, teeth * 2);
  const root = outerRadius * (1 - toothDepth * 0.45);
  const tip = outerRadius * (1 + toothDepth);
  const points: Point[] = [];

  for (let index = 0; index < steps; index += 1) {
    const angle = startAngle + (index / steps) * Math.PI * 2;
    const radius = index % 2 === 0 ? root : tip;
    points.push(polar(cx, cy, radius, angle));
  }

  return `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")} Z`;
}

function pointsToClosedPath(points: Point[]): string {
  if (!points.length) {
    return "";
  }

  return `${pointsToPath(points)} Z`;
}

function appendArcPoints(points: Point[], cx: number, cy: number, radius: number, startAngle: number, endAngle: number): void {
  const sweep = endAngle - startAngle;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));

  for (let step = 1; step <= steps; step += 1) {
    const angle = startAngle + (sweep * step) / steps;
    points.push(polar(cx, cy, radius, angle));
  }
}

function buildGearBoundaryPath({
  teeth,
  cx,
  cy,
  pitchRadius,
  startAngle = -Math.PI / 2,
  internal = false,
  pressureAngleDeg = EXPORT_PRESSURE_ANGLE_DEG,
  backlashFactor = EXPORT_BACKLASH_FACTOR,
  addendumFactor = 1,
  dedendumFactor = 1.25,
}: GearBoundaryInput): string {
  const moduleSize = (2 * pitchRadius) / teeth;
  const pressureAngle = (pressureAngleDeg * Math.PI) / 180;
  const toothAngle = (Math.PI * 2) / teeth;
  const backlash = moduleSize * backlashFactor;
  const addendum = moduleSize * addendumFactor;
  const dedendum = moduleSize * dedendumFactor;
  const tipRadius = internal ? pitchRadius - addendum : pitchRadius + addendum;
  const rootRadius = internal ? pitchRadius + dedendum : Math.max(moduleSize * 1.2, pitchRadius - dedendum);
  const pitchHalfThickness = Math.max((toothAngle * pitchRadius) / 4 - backlash / 2, moduleSize * 0.45);

  function halfAngleAtRadius(radius: number): number {
    const radialDelta = radius - pitchRadius;
    const adjustedHalfThickness = internal
      ? pitchHalfThickness + radialDelta * Math.tan(pressureAngle)
      : pitchHalfThickness - radialDelta * Math.tan(pressureAngle);
    const limitedHalfThickness = clamp(adjustedHalfThickness, moduleSize * 0.32, toothAngle * pitchRadius * 0.45);
    return limitedHalfThickness / Math.max(radius, 1);
  }

  const tipHalfAngle = halfAngleAtRadius(tipRadius);
  const pitchHalfAngle = halfAngleAtRadius(pitchRadius);
  const rootHalfAngle = halfAngleAtRadius(rootRadius);
  const points: Point[] = [];
  let firstRootLeftAngle = 0;
  let previousRootRightAngle = 0;

  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const centerAngle = startAngle + tooth * toothAngle;
    const rootLeftAngle = centerAngle - rootHalfAngle;
    const pitchLeftAngle = centerAngle - pitchHalfAngle;
    const tipLeftAngle = centerAngle - tipHalfAngle;
    const tipRightAngle = centerAngle + tipHalfAngle;
    const pitchRightAngle = centerAngle + pitchHalfAngle;
    const rootRightAngle = centerAngle + rootHalfAngle;

    if (tooth === 0) {
      firstRootLeftAngle = rootLeftAngle;
      points.push(polar(cx, cy, rootRadius, rootLeftAngle));
    } else {
      appendArcPoints(points, cx, cy, rootRadius, previousRootRightAngle, rootLeftAngle);
    }

    points.push(polar(cx, cy, pitchRadius, pitchLeftAngle));
    points.push(polar(cx, cy, tipRadius, tipLeftAngle));
    appendArcPoints(points, cx, cy, tipRadius, tipLeftAngle, tipRightAngle);
    points.push(polar(cx, cy, pitchRadius, pitchRightAngle));
    points.push(polar(cx, cy, rootRadius, rootRightAngle));
    previousRootRightAngle = rootRightAngle;
  }

  appendArcPoints(points, cx, cy, rootRadius, previousRootRightAngle, firstRootLeftAngle + Math.PI * 2);
  return pointsToClosedPath(points);
}

function circlePath(cx: number, cy: number, radius: number): string {
  return `M ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 1 0 ${(cx + radius).toFixed(2)} ${cy.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 1 0 ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} Z`;
}

function makePenHolePoints(
  cx: number,
  cy: number,
  radius: number,
  count: number,
  phase = -Math.PI / 2,
  innerFactor = 0.18,
  outerFactor = 0.9,
): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0 : index / (count - 1);
    const ringRadius = radius * (innerFactor + t * (outerFactor - innerFactor));
    return polar(cx, cy, ringRadius, phase + t * 0.42);
  });
}

function buildMechanismSvg({ ringTeeth, gearTeeth, mode, penOffset }: BuildMechanismInput): string {
  const size = 900;
  const cx = size / 2;
  const cy = size / 2;
  const ringPitchRadius = 310;
  const moduleSize = (2 * ringPitchRadius) / ringTeeth;
  const gearPitchRadius = ringPitchRadius * (gearTeeth / ringTeeth);
  const centerDistance = mode === "inside" ? ringPitchRadius - gearPitchRadius : ringPitchRadius + gearPitchRadius;
  const gearCx = mode === "inside" ? cx : cx + centerDistance;
  const gearCy = cy;
  const ringOuterPerimeterRadius = ringPitchRadius + moduleSize * EXPORT_RING_WALL_FACTOR;
  const ringHubRadius = Math.max(moduleSize * 3.2, 30);
  const gearHubRadius = Math.max(gearPitchRadius * 0.18, moduleSize * 1.8);
  const ringPath =
    mode === "inside"
      ? buildGearBoundaryPath({
          teeth: ringTeeth,
          cx,
          cy,
          pitchRadius: ringPitchRadius,
          internal: true,
        })
      : buildGearBoundaryPath({
          teeth: ringTeeth,
          cx,
          cy,
          pitchRadius: ringPitchRadius,
          internal: false,
        });
  const ringBodyPath = mode === "inside" ? circlePath(cx, cy, ringOuterPerimeterRadius) : null;
  const gearPathForExport = buildGearBoundaryPath({
    teeth: gearTeeth,
    cx: gearCx,
    cy: gearCy,
    pitchRadius: gearPitchRadius,
    internal: false,
  });
  const penHoles = makePenHolePoints(gearCx, gearCy, gearPitchRadius, 9, -Math.PI / 2, 0.16, 0.62);
  const selectedHole = polar(gearCx, gearCy, gearPitchRadius * penOffset, -Math.PI / 2 + 0.42);
  const ringHubPath = mode === "outside" ? circlePath(cx, cy, ringHubRadius) : null;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="white"/>
  <g fill="none" stroke="black" stroke-width="2" vector-effect="non-scaling-stroke">
    ${ringBodyPath ? `<path d="${ringBodyPath}"/>` : ""}
    <path d="${ringPath}"/>
    ${ringHubPath ? `<path d="${ringHubPath}"/>` : ""}
    <path d="${gearPathForExport}"/>
    <circle cx="${gearCx.toFixed(2)}" cy="${gearCy.toFixed(2)}" r="${gearHubRadius.toFixed(2)}"/>
    ${penHoles.map((point) => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="5"/>`).join("\n    ")}
    <circle cx="${selectedHole.x.toFixed(2)}" cy="${selectedHole.y.toFixed(2)}" r="9" stroke="${HOT}"/>
  </g>
  <g font-family="monospace" font-size="18" fill="black">
    <text x="42" y="820">SPIROGRAPH MECHANISM EXPORT</text>
    <text x="42" y="848">RING ${ringTeeth} / GEAR ${gearTeeth} / ${mode.toUpperCase()} / PEN ${(penOffset * 100).toFixed(0)}%</text>
    <text x="42" y="876">20 DEG PRESSURE / ${EXPORT_BACKLASH_FACTOR.toFixed(2)}M BACKLASH / KERF TUNE BEFORE CUTTING</text>
  </g>
</svg>`;
}

function runTests(): void {
  console.assert(gcd(96, 36) === 12, "gcd reduces common toy ratios");
  console.assert(fraction(96, 36) === "8:3", "fraction simplifies ratios");
  console.assert(clamp(120, 0, 100) === 100, "clamp max works");
  console.assert(pointsToPath([{ x: 1, y: 2 }, { x: 3, y: 4 }]) === "M1.00 2.00 L3.00 4.00", "path conversion works");
  const curve = buildCurve({
    ringTeeth: 96,
    gearTeeth: 36,
    penOffset: 0.5,
    mode: "inside",
    phase: 0,
    width: 500,
    height: 500,
    samples: 300,
  });
  console.assert(curve.points.length === 301, "curve point count includes end point");
  console.assert(gearPath(20, 100, 100, 50).startsWith("M"), "gear path is valid SVG path data");
  console.assert(buildGearBoundaryPath({ teeth: 24, cx: 0, cy: 0, pitchRadius: 120 }).startsWith("M"), "working gear boundary path is valid SVG path data");
}

if (typeof console !== "undefined") {
  runTests();
}

function downloadText(filename: string, text: string, type = "image/svg+xml;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border border-zinc-300 bg-[#fbfaf7] shadow-[8px_8px_0_#09090b] ${className}`}>{children}</section>;
}

function MicroLabel({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">{children}</div>;
}

function RangeControl({ label, value, min, max, step, onChange, suffix = "" }: RangeControlProps) {
  return (
    <label className="grid gap-1.5 border-t border-zinc-200 pt-2">
      <span className="flex items-center justify-between gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
        <span>{label}</span>
        <span className="text-zinc-950">
          {value}
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
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ToggleButton({ active, children, onClick }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-3 py-2 font-mono text-[11px] font-black uppercase tracking-[0.12em] transition ${
        active ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950"
      }`}
    >
      {children}
    </button>
  );
}

function SpiroArtboard({ ringTeeth, gearTeeth, penOffset, mode, phase, progress, showMechanism, showTeeth, inkColor }: SpiroArtboardProps) {
  const width = 720;
  const height = 720;

  const curve = useMemo(
    () => buildCurve({ ringTeeth, gearTeeth, penOffset, mode, phase, width, height, samples: CURVE_SAMPLES }),
    [ringTeeth, gearTeeth, penOffset, mode, phase],
  );

  const visibleIndex = Math.max(1, Math.min(CURVE_SAMPLES, Math.round(progress * CURVE_SAMPLES)));
  const visibleCount = visibleIndex + 1;
  const visiblePoints = curve.points.slice(0, visibleCount);
  const fullPath = pointsToPath(curve.points);
  const visiblePath = pointsToPath(visiblePoints);
  const penPoint = visiblePoints[visiblePoints.length - 1] ?? curve.points[0];

  const curveProgress = visibleIndex / CURVE_SAMPLES;
  const t = curve.maxT * curveProgress + phase;
  const R = curve.R;
  const r = curve.r;
  const cx = curve.cx;
  const cy = curve.cy;
  const scale = curve.scale;

  const gearCenterRaw =
    mode === "inside"
      ? { x: (R - r) * Math.cos(t), y: (R - r) * Math.sin(t) }
      : { x: (R + r) * Math.cos(t), y: (R + r) * Math.sin(t) };

  const gearSpin = mode === "inside" ? (-((R - r) / r) * t) : (((R + r) / r) * t + Math.PI);
  const mechanismAngle = gearSpin + MECHANISM_PHASE_OFFSET;
  const gearCenter = { x: cx + gearCenterRaw.x * scale, y: cy + gearCenterRaw.y * scale };
  const ringRadiusPx = R * scale;
  const gearRadiusPx = r * scale;
  const penRadiusPx = penOffset * r * scale;
  const penPreview = {
    x: gearCenter.x + penRadiusPx * Math.cos(gearSpin),
    y: gearCenter.y + penRadiusPx * Math.sin(gearSpin),
  };

  const ringPath =
    mode === "inside"
      ? innerRingTeethPath(ringTeeth, cx, cy, ringRadiusPx, 0.045)
      : outerRingTeethPath(ringTeeth, cx, cy, ringRadiusPx, 0.045);
  const gearOutline = gearPath(gearTeeth, gearCenter.x, gearCenter.y, gearRadiusPx, 0.08, 0.02, mechanismAngle);

  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden border border-zinc-950 bg-[#f7f5ef] shadow-[10px_10px_0_#09090b] md:min-h-0">
      <svg id="spiro-artboard" viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label="Spirograph ratio drawing preview">
        <defs>
          <pattern id="microGrid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#d8d5cc" strokeWidth="1" />
          </pattern>
          <filter id="inkBleed" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.35" />
          </filter>
        </defs>

        <rect width={width} height={height} fill={PAPER} />
        <rect width={width} height={height} fill="url(#microGrid)" opacity="0.7" />

        <g opacity="0.6">
          {Array.from({ length: 9 }).map((_, index) => (
            <circle key={index} cx={cx} cy={cy} r={54 + index * 32} fill="none" stroke="#c9c5ba" strokeWidth="1" strokeDasharray="1 9" />
          ))}
          {Array.from({ length: 32 }).map((_, index) => {
            const angle = (index / 32) * Math.PI * 2;
            const p1 = polar(cx, cy, 28, angle);
            const p2 = polar(cx, cy, 325, angle);

            return <line key={index} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#d6d2c7" strokeWidth="1" />;
          })}
        </g>

        <g transform="translate(28 34)">
          <text fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="800" letterSpacing="3" fill="#52525b">
            RATIO_LAB / DRAWING_GEAR_SYSTEM
          </text>
          <text y="39" fontFamily='"IBM Plex Sans", ui-sans-serif, system-ui' fontSize="42" fontWeight="950" letterSpacing="-3" fill={INK}>
            {ringTeeth}:{gearTeeth}
          </text>
          <rect x="0" y="54" width="140" height="7" fill={inkColor} />
          <text y="82" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="11" fontWeight="800" letterSpacing="2" fill="#52525b">
            REDUCED {fraction(ringTeeth, gearTeeth)} / {mode.toUpperCase()} / {curve.loops} LOOP CLOSURE
          </text>
        </g>

        <circle cx={cx} cy={cy} r={ringRadiusPx} fill="none" stroke="#111827" strokeWidth="1.7" />

        {showMechanism && (
          <g opacity="0.95">
            {showTeeth ? (
              <path d={ringPath} fill="none" stroke="#111827" strokeWidth="1.2" strokeLinejoin="miter" />
            ) : (
              <circle cx={cx} cy={cy} r={ringRadiusPx} fill="none" stroke="#111827" strokeWidth="1.2" strokeDasharray="3 7" />
            )}
            {showTeeth ? (
              <path d={gearOutline} fill="rgba(255,255,255,0.38)" stroke="#111827" strokeWidth="1.35" strokeLinejoin="miter" />
            ) : (
              <circle cx={gearCenter.x} cy={gearCenter.y} r={gearRadiusPx} fill="rgba(255,255,255,0.35)" stroke="#111827" strokeWidth="1.35" />
            )}
            <circle cx={gearCenter.x} cy={gearCenter.y} r={Math.max(3, gearRadiusPx * 0.08)} fill="none" stroke="#111827" strokeWidth="1" />
            <line x1={gearCenter.x} y1={gearCenter.y} x2={penPreview.x} y2={penPreview.y} stroke="#111827" strokeWidth="2" />
            <circle cx={penPreview.x} cy={penPreview.y} r="6" fill={HOT} stroke="#111827" strokeWidth="1" />
          </g>
        )}

        <path d={fullPath} fill="none" stroke={inkColor} strokeOpacity="0.13" strokeWidth="2.2" />
        <path d={visiblePath} fill="none" stroke={INK} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" filter="url(#inkBleed)" />
        <path d={visiblePath} fill="none" stroke={inkColor} strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={penPoint.x} cy={penPoint.y} r="5" fill={HOT} stroke={INK} strokeWidth="1.2" />

        <g transform="translate(28 670)">
          <text fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="10" fontWeight="800" letterSpacing="2" fill="#52525b">
            PEN_OFFSET {(penOffset * 100).toFixed(0)}% / PROGRESS {(progress * 100).toFixed(0)}% / TEETH_OVERLAY {showTeeth ? "ON" : "OFF"}
          </text>
        </g>
      </svg>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<TrochoidMode>("outside");
  const [ringTeeth, setRingTeeth] = useState(84);
  const [gearTeeth, setGearTeeth] = useState(35);
  const [penOffset, setPenOffset] = useState(0.58);
  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState(1);
  const [animate, setAnimate] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState(50);
  const [showMechanism, setShowMechanism] = useState(false);
  const [showTeeth, setShowTeeth] = useState(false);
  const [inkColor, setInkColor] = useState(HOT);

  useEffect(() => {
    if (!animate) {
      setProgress(1);
      return undefined;
    }

    let animationFrame = 0;
    let startTime = 0;

    const speedMultiplier = Math.max(animationSpeed / 100, 0.1);
    const duration = ANIMATION_BASE_DURATION_MS / speedMultiplier;

    const tick = (timestamp: number) => {
      if (startTime === 0) {
        startTime = timestamp;
      }

      const elapsed = timestamp - startTime;
      const loop = (elapsed % duration) / duration;
      setProgress(clamp(loop, 0.015, 1));
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [animate, animationSpeed]);

  const maxGear = mode === "inside" ? Math.max(8, ringTeeth - 4) : 120;
  const reduced = fraction(ringTeeth, gearTeeth);
  const closure = gearTeeth / gcd(ringTeeth, gearTeeth);

  function applyPreset(preset: Preset): void {
    setRingTeeth(preset.ring);
    setGearTeeth(preset.gear);
    setPenOffset(preset.offset);
    setMode(preset.mode);
    setInkColor(preset.ink);
    setProgress(1);
  }

  function exportDrawingSvg(): void {
    const svg = document.getElementById("spiro-artboard");

    if (!(svg instanceof SVGSVGElement)) {
      return;
    }

    const clone = svg.cloneNode(true);

    if (!(clone instanceof SVGSVGElement)) {
      return;
    }

    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    downloadText(`spirograph-drawing-${ringTeeth}-${gearTeeth}.svg`, clone.outerHTML);
  }

  function exportMechanismSvg(): void {
    const svg = buildMechanismSvg({ ringTeeth, gearTeeth, mode, penOffset });
    downloadText(`spirograph-ring-gear-${ringTeeth}-${gearTeeth}.svg`, svg);
  }

  function reset(): void {
    setMode("outside");
    setRingTeeth(84);
    setGearTeeth(35);
    setPenOffset(0.58);
    setPhase(0);
    setProgress(1);
    setAnimate(true);
    setAnimationSpeed(65);
    setShowMechanism(false);
    setShowTeeth(false);
    setInkColor(HOT);
  }

  return (
    <main className="min-h-screen bg-[#ece8df] text-zinc-950">
      <div className="mx-auto grid min-h-screen w-full max-w-[1500px] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_430px] lg:p-4">
        <section className="sticky top-3 z-10 h-[62vh] min-h-[360px] lg:h-[calc(100vh-2rem)]">
          <SpiroArtboard
            ringTeeth={ringTeeth}
            gearTeeth={gearTeeth}
            penOffset={penOffset}
            mode={mode}
            phase={phase}
            progress={progress}
            showMechanism={showMechanism}
            showTeeth={showTeeth}
            inkColor={inkColor}
          />
        </section>

        <aside className="grid content-start gap-3 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-2">
          <Panel>
            <div className="grid gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <MicroLabel>spirograph ratio terminal</MicroLabel>
                  <h1 className="mt-1 text-3xl font-black uppercase leading-none tracking-[-0.08em] sm:text-4xl">Gear Pattern Lab</h1>
                </div>
                <div className="border border-zinc-950 bg-zinc-950 px-3 py-2 font-mono text-xs font-black text-white shadow-[4px_4px_0_#ff3b30]">
                  {mode}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-zinc-300 pt-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em]">
                <div>
                  <span className="text-zinc-500">ratio</span>
                  <br />
                  {ringTeeth}:{gearTeeth}
                </div>
                <div>
                  <span className="text-zinc-500">reduced</span>
                  <br />
                  {reduced}
                </div>
                <div>
                  <span className="text-zinc-500">closure</span>
                  <br />
                  {closure} turns
                </div>
              </div>
            </div>
          </Panel>

          <Panel>
            <div className="grid gap-3 p-4">
              <MicroLabel>fast presets</MicroLabel>
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="border border-zinc-300 bg-white p-2 text-left transition hover:border-zinc-950 hover:bg-zinc-950 hover:text-white"
                  >
                    <div className="font-mono text-xs font-black">{preset.label}</div>
                    <div className="mt-1 h-1.5 w-10" style={{ backgroundColor: preset.ink }} />
                    <div className="mt-1 font-mono text-[9px] uppercase tracking-widest text-zinc-500">{preset.mode}</div>
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel>
            <div className="grid gap-3 p-4">
              <MicroLabel>machine mode</MicroLabel>
              <div className="grid grid-cols-2 gap-2">
                <ToggleButton
                  active={mode === "inside"}
                  onClick={() => {
                    setMode("inside");
                    if (gearTeeth >= ringTeeth) {
                      setGearTeeth(Math.max(8, ringTeeth - 4));
                    }
                  }}
                >
                  inside
                </ToggleButton>
                <ToggleButton active={mode === "outside"} onClick={() => setMode("outside")}>
                  outside
                </ToggleButton>
                <ToggleButton active={showMechanism} onClick={() => setShowMechanism((value) => !value)}>
                  overlay
                </ToggleButton>
                <ToggleButton active={showTeeth} onClick={() => setShowTeeth((value) => !value)}>
                  teeth
                </ToggleButton>
              </div>

              <RangeControl
                label="ring teeth"
                value={ringTeeth}
                min={24}
                max={180}
                step={1}
                onChange={(value) => {
                  setRingTeeth(value);
                  if (mode === "inside" && gearTeeth >= value) {
                    setGearTeeth(Math.max(8, value - 4));
                  }
                }}
              />
              <RangeControl label="gear teeth" value={gearTeeth} min={8} max={maxGear} step={1} onChange={setGearTeeth} />
              <RangeControl
                label="pen offset"
                value={Math.round(penOffset * 100)}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={(value) => setPenOffset(value / 100)}
              />
              <RangeControl
                label="phase"
                value={Math.round((phase * 180) / Math.PI)}
                min={0}
                max={360}
                step={1}
                suffix="°"
                onChange={(value) => setPhase((value * Math.PI) / 180)}
              />
              {!animate && (
                <RangeControl
                  label="draw progress"
                  value={Math.round(progress * 100)}
                  min={1}
                  max={100}
                  step={1}
                  suffix="%"
                  onChange={(value) => setProgress(value / 100)}
                />
              )}
              {animate && (
                <RangeControl
                  label="animation speed"
                  value={animationSpeed}
                  min={25}
                  max={300}
                  step={5}
                  suffix="%"
                  onChange={setAnimationSpeed}
                />
              )}
            </div>
          </Panel>

          <Panel>
            <div className="grid gap-3 p-4">
              <MicroLabel>ink channel</MicroLabel>
              <div className="grid grid-cols-6 gap-2">
                {[ACCENT, HOT, "#111827", "#6d28d9", "#0f766e", "#be123c"].map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Set ink color ${color}`}
                    onClick={() => setInkColor(color)}
                    className={`h-9 border ${inkColor === color ? "border-zinc-950 ring-2 ring-zinc-950" : "border-zinc-300"}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAnimate((value) => !value)}
                  className="border border-zinc-950 bg-zinc-950 px-3 py-3 font-mono text-xs font-black uppercase tracking-widest text-white hover:bg-white hover:text-zinc-950"
                >
                  {animate ? "stop draw" : "animate"}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="border border-zinc-950 bg-white px-3 py-3 font-mono text-xs font-black uppercase tracking-widest text-zinc-950 hover:bg-zinc-950 hover:text-white"
                >
                  reset
                </button>
              </div>
            </div>
          </Panel>

          <section className="border border-zinc-950 bg-zinc-950 text-white shadow-[8px_8px_0_#ff3b30]">
            <div className="grid gap-3 p-4">
              <MicroLabel>svg output</MicroLabel>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={exportDrawingSvg}
                  className="border border-white/30 bg-white px-3 py-3 font-mono text-xs font-black uppercase tracking-widest text-zinc-950 hover:bg-zinc-200"
                >
                  export drawing
                </button>
                <button
                  type="button"
                  onClick={exportMechanismSvg}
                  className="border border-white/30 bg-zinc-900 px-3 py-3 font-mono text-xs font-black uppercase tracking-widest text-white hover:bg-zinc-800"
                >
                  export gear/ring
                </button>
              </div>
              <p className="font-mono text-[10px] uppercase leading-5 tracking-[0.16em] text-zinc-400">
                Gear/ring SVG is schematic tooth geometry for iteration and fabrication planning. Drawing SVG exports the current visible artboard.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}