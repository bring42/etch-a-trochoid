import Matter, { type Body, type Collision } from "matter-js";

export type TrochoidMode = "inside" | "outside";

export type Point = {
  x: number;
  y: number;
};

export type MechanismEvaluation = {
  status: "viable" | "risk";
  label: string;
  detail: string;
  penetration: number;
  holeClearance: number;
  moduleSize: number;
  selectedHoleRadius: number;
};

type CurveInput = {
  ringTeeth: number;
  gearTeeth: number;
  penOffset: number;
  mode: TrochoidMode;
  samples: number;
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

type LayoutInput = {
  ringTeeth: number;
  gearTeeth: number;
  mode: TrochoidMode;
  penOffset: number;
};

type MechanismLayout = {
  ringTeeth: number;
  gearTeeth: number;
  mode: TrochoidMode;
  penOffset: number;
  moduleSize: number;
  ringPitchRadius: number;
  gearPitchRadius: number;
  ringOuterRadius: number;
  ringHubRadius: number;
  gearHubRadius: number;
  gearRootRadius: number;
  holeRadius: number;
  holeSpacing: number;
  meshDistance: number;
  ringBoundary: Point[];
  gearBoundary: Point[];
  penHoles: Point[];
  selectedHole: Point;
  selectedHoleRadius: number;
  mountingHoles: Point[];
};

const { Bodies, Query } = Matter;

const EXPORT_MODULE_MM = 2;
const EXPORT_PRESSURE_ANGLE_DEG = 20;
const EXPORT_BACKLASH_FACTOR = 0.18;
const EXPORT_RING_WALL_FACTOR = 5.5;
const EXPORT_PEN_HOLE_OUTER_CAP = 0.52;
const EXPORT_DRAWING_MARGIN = 18;
const EXPORT_MECHANISM_MARGIN = 16;
const EXPORT_MECHANISM_GAP = 24;
const EXPORT_INFO_HEIGHT = 40;
const VALIDATION_ROTATION_STEPS = 72;

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

  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join(" ");
}

function pointsToClosedPath(points: Point[]): string {
  if (!points.length) {
    return "";
  }

  return `${pointsToPath(points)} Z`;
}

function appendArcPoints(points: Point[], cx: number, cy: number, radius: number, startAngle: number, endAngle: number): void {
  const sweep = endAngle - startAngle;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 28)));

  for (let step = 1; step <= steps; step += 1) {
    const angle = startAngle + (sweep * step) / steps;
    points.push(polar(cx, cy, radius, angle));
  }
}

function buildGearBoundaryPoints({
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
}: GearBoundaryInput): Point[] {
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
  return points;
}

function circlePoints(cx: number, cy: number, radius: number, steps = 180): Point[] {
  const points: Point[] = [];

  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push(polar(cx, cy, radius, angle));
  }

  return points;
}

function circlePath(cx: number, cy: number, radius: number): string {
  return `M ${(cx - radius).toFixed(3)} ${cy.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 1 0 ${(cx + radius).toFixed(3)} ${cy.toFixed(
    3,
  )} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 1 0 ${(cx - radius).toFixed(3)} ${cy.toFixed(3)} Z`;
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

function buildCurvePoints({ ringTeeth, gearTeeth, penOffset, mode, samples }: CurveInput): Point[] {
  const common = gcd(ringTeeth, gearTeeth);
  const loops = gearTeeth / common;
  const maxT = Math.PI * 2 * loops;
  const scale = EXPORT_MODULE_MM / 2;
  const points: Point[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = (index / samples) * maxT;
    const raw = mode === "inside"
      ? hypotrochoidPoint(ringTeeth, gearTeeth, penOffset * gearTeeth, t)
      : epitrochoidPoint(ringTeeth, gearTeeth, penOffset * gearTeeth, t);
    points.push({ x: raw.x * scale, y: raw.y * scale });
  }

  return points;
}

function makePenHolePoints(startRadius: number, maxRadius: number, spacing: number, phase = -Math.PI / 2): Point[] {
  if (spacing <= 0 || startRadius > maxRadius) {
    return [];
  }

  const points: Point[] = [];

  for (let holeRadius = startRadius; holeRadius <= maxRadius + 0.001; holeRadius += spacing) {
    points.push(polar(0, 0, holeRadius, phase));
  }

  return points;
}

function computeMechanismLayout({ ringTeeth, gearTeeth, mode, penOffset }: LayoutInput): MechanismLayout {
  const moduleSize = EXPORT_MODULE_MM;
  const ringPitchRadius = (ringTeeth * moduleSize) / 2;
  const gearPitchRadius = (gearTeeth * moduleSize) / 2;
  const ringOuterRadius = mode === "inside" ? ringPitchRadius + moduleSize * EXPORT_RING_WALL_FACTOR : ringPitchRadius + moduleSize;
  const ringHubRadius = Math.max(moduleSize * 3.2, 6);
  const gearHubRadius = Math.max(gearPitchRadius * 0.18, moduleSize * 1.8);
  const gearRootRadius = Math.max(moduleSize * 1.2, gearPitchRadius - moduleSize * 1.25);
  const holeRadius = Math.max(1.6, moduleSize * 0.34);
  const holeSpacing = holeRadius * 4;
  const firstHoleRadius = gearHubRadius + holeSpacing;
  const maxHoleRadius = Math.min(gearRootRadius - holeRadius - moduleSize * 0.4, gearPitchRadius * EXPORT_PEN_HOLE_OUTER_CAP);
  const penHoles = makePenHolePoints(firstHoleRadius, maxHoleRadius, holeSpacing);
  const targetPenRadius = clamp(gearPitchRadius * penOffset, firstHoleRadius, maxHoleRadius);
  const selectedHole = penHoles.reduce((bestPoint, point) => {
    const bestDistance = Math.abs(Math.hypot(bestPoint.x, bestPoint.y) - targetPenRadius);
    const pointDistance = Math.abs(Math.hypot(point.x, point.y) - targetPenRadius);
    return pointDistance < bestDistance ? point : bestPoint;
  }, penHoles[0] ?? polar(0, 0, Math.max(firstHoleRadius, 0), -Math.PI / 2));
  const selectedHoleRadius = Math.hypot(selectedHole.x, selectedHole.y);
  const mountingRadius = mode === "inside" ? ringPitchRadius + moduleSize * 3.1 : Math.max(ringHubRadius + moduleSize * 4, ringPitchRadius * 0.58);
  const mountingHoles = Array.from({ length: 4 }, (_, index) => polar(0, 0, mountingRadius, -Math.PI / 4 + index * (Math.PI / 2)));

  return {
    ringTeeth,
    gearTeeth,
    mode,
    penOffset,
    moduleSize,
    ringPitchRadius,
    gearPitchRadius,
    ringOuterRadius,
    ringHubRadius,
    gearHubRadius,
    gearRootRadius,
    holeRadius,
    holeSpacing,
    meshDistance: mode === "inside" ? ringPitchRadius - gearPitchRadius : ringPitchRadius + gearPitchRadius,
    ringBoundary: buildGearBoundaryPoints({
      teeth: ringTeeth,
      cx: 0,
      cy: 0,
      pitchRadius: ringPitchRadius,
      internal: mode === "inside",
    }),
    gearBoundary: buildGearBoundaryPoints({
      teeth: gearTeeth,
      cx: 0,
      cy: 0,
      pitchRadius: gearPitchRadius,
      internal: false,
    }),
    penHoles,
    selectedHole,
    selectedHoleRadius,
    mountingHoles,
  };
}

function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function rotatePoints(points: Point[], angle: number): Point[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((point) => ({ x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }));
}

function unwrapAngles(points: Point[]): number[] {
  if (!points.length) {
    return [];
  }

  const angles = points.map((point) => Math.atan2(point.y, point.x));

  for (let index = 1; index < angles.length; index += 1) {
    while (angles[index] <= angles[index - 1]) {
      angles[index] += Math.PI * 2;
    }
  }

  return angles;
}

function toBody(points: Point[]): Body | null {
  return Bodies.fromVertices(0, 0, [points], { isStatic: true }, true);
}

function buildRingBodies(layout: MechanismLayout): Body[] {
  if (layout.mode === "outside") {
    return [toBody(layout.ringBoundary)].filter((body): body is Body => body !== null);
  }

  const angles = unwrapAngles(layout.ringBoundary);
  const bodies: Body[] = [];

  for (let index = 0; index < layout.ringBoundary.length; index += 1) {
    const nextIndex = (index + 1) % layout.ringBoundary.length;
    const startAngle = angles[index];
    const endAngle = nextIndex === 0 ? angles[index] + Math.PI * 2 : angles[nextIndex];
    const innerA = layout.ringBoundary[index];
    const innerB = layout.ringBoundary[nextIndex];
    const outerA = polar(0, 0, layout.ringOuterRadius, startAngle);
    const outerB = polar(0, 0, layout.ringOuterRadius, endAngle);
    const body = toBody([innerA, innerB, outerB, outerA]);

    if (body) {
      bodies.push(body);
    }
  }

  return bodies;
}

export function evaluateMechanismSetup(input: LayoutInput): MechanismEvaluation {
  if (input.mode === "inside" && input.gearTeeth >= input.ringTeeth) {
    return {
      status: "risk",
      label: "interference risk",
      detail: "Inside gears need the rolling gear smaller than the ring.",
      penetration: Number.POSITIVE_INFINITY,
      holeClearance: -1,
      moduleSize: EXPORT_MODULE_MM,
      selectedHoleRadius: 0,
    };
  }

  const layout = computeMechanismLayout(input);
  const ringBodies = buildRingBodies(layout);
  const pitchAngle = (Math.PI * 2) / Math.max(layout.gearTeeth, 1);
  let bestPenetration = Number.POSITIVE_INFINITY;
  let bestCollisionCount = Number.POSITIVE_INFINITY;

  for (let step = 0; step < VALIDATION_ROTATION_STEPS; step += 1) {
    const angle = (step / VALIDATION_ROTATION_STEPS) * pitchAngle;
    const rotatedGear = rotatePoints(layout.gearBoundary, angle);
    const translatedGear = translatePoints(rotatedGear, layout.meshDistance, 0);
    const gearBody = toBody(translatedGear);
    const collisions = gearBody ? Query.collides(gearBody, ringBodies) : [];
    const penetration = collisions.reduce((maxDepth: number, collision: Collision) => Math.max(maxDepth, collision.depth ?? 0), 0);

    if (collisions.length < bestCollisionCount || (collisions.length === bestCollisionCount && penetration < bestPenetration)) {
      bestCollisionCount = collisions.length;
      bestPenetration = penetration;
    }
  }

  const holeClearance = layout.gearRootRadius - (layout.selectedHoleRadius + layout.holeRadius);
  const hasUsableHoleBand = layout.penHoles.length > 0 && Number.isFinite(holeClearance);
  const collisionRisk = bestCollisionCount > 0 && bestPenetration > layout.moduleSize * 0.06;
  const holeRisk = !hasUsableHoleBand || holeClearance < layout.moduleSize * 0.45;
  const status = collisionRisk || holeRisk ? "risk" : "viable";
  const detail = collisionRisk
    ? `Best mesh search still overlaps by ${bestPenetration.toFixed(2)} mm.`
    : holeRisk
      ? `Selected pen hole leaves only ${Math.max(holeClearance, 0).toFixed(2)} mm to the tooth root.`
      : `Mesh search cleared with ${holeClearance.toFixed(2)} mm around the chosen pen hole.`;

  return {
    status,
    label: status === "viable" ? "looks viable" : "interference risk",
    detail,
    penetration: Number.isFinite(bestPenetration) ? bestPenetration : 0,
    holeClearance,
    moduleSize: layout.moduleSize,
    selectedHoleRadius: layout.selectedHoleRadius,
  };
}

function measurementLine(x1: number, y1: number, x2: number, y2: number, label: string): string {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2 - 2.2;
  return `<g stroke="#2563eb" stroke-width="0.25" fill="none"><line x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(
    3,
  )}"/><line x1="${x1.toFixed(3)}" y1="${(y1 - 2).toFixed(3)}" x2="${x1.toFixed(3)}" y2="${(y1 + 2).toFixed(3)}"/><line x1="${x2.toFixed(
    3,
  )}" y1="${(y2 - 2).toFixed(3)}" x2="${x2.toFixed(3)}" y2="${(y2 + 2).toFixed(3)}"/></g><text x="${midX.toFixed(3)}" y="${midY.toFixed(
    3,
  )}" text-anchor="middle" font-size="3.6" font-family="monospace" fill="#1d4ed8">${label}</text>`;
}

export function buildFabricationSvg(input: LayoutInput): string {
  const layout = computeMechanismLayout(input);
  const evaluation = evaluateMechanismSetup(input);
  const ringExtent = layout.ringOuterRadius;
  const gearExtent = layout.gearPitchRadius + layout.moduleSize;
  const width = EXPORT_MECHANISM_MARGIN * 2 + ringExtent * 2 + EXPORT_MECHANISM_GAP + gearExtent * 2;
  const height = EXPORT_MECHANISM_MARGIN * 2 + Math.max(ringExtent, gearExtent) * 2 + EXPORT_INFO_HEIGHT;
  const centerY = EXPORT_MECHANISM_MARGIN + Math.max(ringExtent, gearExtent);
  const ringCenterX = EXPORT_MECHANISM_MARGIN + ringExtent;
  const gearCenterX = width - EXPORT_MECHANISM_MARGIN - gearExtent;
  const ringBoundary = translatePoints(layout.ringBoundary, ringCenterX, centerY);
  const gearBoundary = translatePoints(layout.gearBoundary, gearCenterX, centerY);
  const penHoles = translatePoints(layout.penHoles, gearCenterX, centerY);
  const selectedHole = { x: gearCenterX + layout.selectedHole.x, y: centerY + layout.selectedHole.y };
  const mountingHoles = translatePoints(layout.mountingHoles, ringCenterX, centerY);
  const ringOuterPath = circlePath(ringCenterX, centerY, layout.ringOuterRadius);
  const ringInnerHubPath = input.mode === "outside" ? circlePath(ringCenterX, centerY, layout.ringHubRadius) : "";
  const riskColor = evaluation.status === "viable" ? "#166534" : "#b45309";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(3)}mm" height="${height.toFixed(3)}mm" viewBox="0 0 ${width.toFixed(3)} ${height.toFixed(3)}">
  <rect width="100%" height="100%" fill="white"/>
  <g fill="none" stroke="#111827" stroke-width="0.25" vector-effect="non-scaling-stroke">
    ${input.mode === "inside" ? `<path d="${ringOuterPath}"/><path d="${pointsToClosedPath(ringBoundary)}"/>` : `<path d="${pointsToClosedPath(ringBoundary)}"/>`}
    ${ringInnerHubPath ? `<path d="${ringInnerHubPath}"/>` : ""}
    ${mountingHoles.map((point) => `<circle cx="${point.x.toFixed(3)}" cy="${point.y.toFixed(3)}" r="2.2"/>`).join("\n    ")}
    <path d="${pointsToClosedPath(gearBoundary)}"/>
    <circle cx="${gearCenterX.toFixed(3)}" cy="${centerY.toFixed(3)}" r="${layout.gearHubRadius.toFixed(3)}"/>
    ${penHoles.map((point) => `<circle cx="${point.x.toFixed(3)}" cy="${point.y.toFixed(3)}" r="${layout.holeRadius.toFixed(3)}"/>`).join("\n    ")}
  </g>
  <g fill="none" stroke="#dc2626" stroke-width="0.3" vector-effect="non-scaling-stroke">
    <circle cx="${selectedHole.x.toFixed(3)}" cy="${selectedHole.y.toFixed(3)}" r="${(layout.holeRadius + 1.1).toFixed(3)}"/>
  </g>
  <g fill="none" stroke="#94a3b8" stroke-dasharray="1.5 1.5" stroke-width="0.2" vector-effect="non-scaling-stroke">
    <circle cx="${gearCenterX.toFixed(3)}" cy="${centerY.toFixed(3)}" r="${layout.selectedHoleRadius.toFixed(3)}"/>
    <circle cx="${ringCenterX.toFixed(3)}" cy="${centerY.toFixed(3)}" r="${layout.ringPitchRadius.toFixed(3)}"/>
    <circle cx="${gearCenterX.toFixed(3)}" cy="${centerY.toFixed(3)}" r="${layout.gearPitchRadius.toFixed(3)}"/>
  </g>
  ${measurementLine(ringCenterX - layout.ringPitchRadius, height - 18, ringCenterX + layout.ringPitchRadius, height - 18, `ring pitch Ø ${(layout.ringPitchRadius * 2).toFixed(1)} mm`)}
  ${measurementLine(gearCenterX - layout.gearPitchRadius, height - 18, gearCenterX + layout.gearPitchRadius, height - 18, `gear pitch Ø ${(layout.gearPitchRadius * 2).toFixed(1)} mm`)}
  <g font-family="monospace" fill="#111827">
    <text x="${EXPORT_MECHANISM_MARGIN.toFixed(3)}" y="${(height - 24).toFixed(3)}" font-size="4.4">SPIROGRAPH FABRICATION SHEET / module ${layout.moduleSize.toFixed(2)} mm / 20° pressure / ${EXPORT_BACKLASH_FACTOR.toFixed(2)}m backlash</text>
    <text x="${EXPORT_MECHANISM_MARGIN.toFixed(3)}" y="${(height - 17).toFixed(3)}" font-size="4.2">RING ${input.ringTeeth} / GEAR ${input.gearTeeth} / ${input.mode.toUpperCase()} / PEN ${(input.penOffset * 100).toFixed(0)}% / selected hole r ${layout.selectedHoleRadius.toFixed(1)} mm</text>
    <text x="${EXPORT_MECHANISM_MARGIN.toFixed(3)}" y="${(height - 10).toFixed(3)}" font-size="4.2" fill="${riskColor}">PLAUSIBILITY: ${evaluation.label.toUpperCase()} — ${evaluation.detail}</text>
  </g>
</svg>`;
}

export function buildProductionDrawingSvg(input: LayoutInput & { inkColor: string }): string {
  const layout = computeMechanismLayout(input);
  const evaluation = evaluateMechanismSetup(input);
  const curvePoints = buildCurvePoints({ ...input, samples: 3600 });
  const bounds = curvePoints.reduce(
    (current, point) => ({
      minX: Math.min(current.minX, point.x),
      minY: Math.min(current.minY, point.y),
      maxX: Math.max(current.maxX, point.x),
      maxY: Math.max(current.maxY, point.y),
    }),
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
  );
  const drawingWidth = bounds.maxX - bounds.minX;
  const drawingHeight = bounds.maxY - bounds.minY;
  const width = drawingWidth + EXPORT_DRAWING_MARGIN * 2;
  const height = drawingHeight + EXPORT_DRAWING_MARGIN * 2 + EXPORT_INFO_HEIGHT;
  const shiftedPoints = curvePoints.map((point) => ({
    x: point.x - bounds.minX + EXPORT_DRAWING_MARGIN,
    y: point.y - bounds.minY + EXPORT_DRAWING_MARGIN,
  }));
  const riskColor = evaluation.status === "viable" ? "#166534" : "#b45309";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(3)}mm" height="${height.toFixed(3)}mm" viewBox="0 0 ${width.toFixed(3)} ${height.toFixed(3)}">
  <rect width="100%" height="100%" fill="white"/>
  <rect x="${(EXPORT_DRAWING_MARGIN / 2).toFixed(3)}" y="${(EXPORT_DRAWING_MARGIN / 2).toFixed(3)}" width="${(width - EXPORT_DRAWING_MARGIN).toFixed(3)}" height="${(
    height - EXPORT_INFO_HEIGHT - EXPORT_DRAWING_MARGIN
  ).toFixed(3)}" fill="none" stroke="#e4e4e7" stroke-width="0.25"/>
  <path d="${pointsToPath(shiftedPoints)}" fill="none" stroke="${input.inkColor}" stroke-width="0.35" stroke-linecap="round" stroke-linejoin="round"/>
  <g font-family="monospace" fill="#111827">
    <text x="${EXPORT_DRAWING_MARGIN.toFixed(3)}" y="${(height - 24).toFixed(3)}" font-size="4.4">SPIROGRAPH TRACE / ACTUAL SCALE FROM MODULE ${layout.moduleSize.toFixed(2)} mm</text>
    <text x="${EXPORT_DRAWING_MARGIN.toFixed(3)}" y="${(height - 17).toFixed(3)}" font-size="4.2">RING ${input.ringTeeth} / GEAR ${input.gearTeeth} / ${input.mode.toUpperCase()} / selected hole r ${layout.selectedHoleRadius.toFixed(1)} mm / ${(
    layout.selectedHoleRadius / Math.max(layout.gearPitchRadius, 1)
  ).toFixed(2)} gear radius</text>
    <text x="${EXPORT_DRAWING_MARGIN.toFixed(3)}" y="${(height - 10).toFixed(3)}" font-size="4.2" fill="${riskColor}">PLAUSIBILITY: ${evaluation.label.toUpperCase()} — ${evaluation.detail}</text>
  </g>
</svg>`;
}
