// Core gear and trochoid math.
//
// All linear units here are millimeters. Coordinates are in a centered local
// frame with +x right, +y down (SVG convention). Angles in radians unless
// stated.

export type Point = { x: number; y: number };

export type GearKind = "external" | "internal";

export type GearParams = {
  kind: GearKind;
  teeth: number;
  module: number; // mm per tooth on pitch circle
  pressureAngle: number; // radians, typ. 20° = 0.349
  profileShift: number; // x, dimensionless (0 = none)
  addendumCoef: number; // ha, default 1.0
  dedendumCoef: number; // hf, default 1.25
  boreDiameter: number; // mm, central hole; 0 = no hole
  // Internal gears get an outer rim drawn at this radius (mm); 0 = auto
  rimDiameter?: number;
};

export type GearGeometry = {
  params: GearParams;
  pitchRadius: number;
  baseRadius: number;
  outsideRadius: number; // tip radius (smaller for internal)
  rootRadius: number; // root radius (larger for internal)
  rimRadius: number; // outermost drawn radius
  outerProfile: Point[]; // closed polygon, mm, centered
  rimCircleRadius: number | null; // separate circle for internal rim, mm
  toothPolygon: Point[]; // single tooth template (for debug)
  warnings: string[];
};

export const DEG = Math.PI / 180;

// --- utility ------------------------------------------------------------

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function fraction(a: number, b: number): string {
  const d = gcd(a, b);
  return `${a / d}:${b / d}`;
}

export function polar(cx: number, cy: number, r: number, a: number): Point {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function pointsToPath(points: Point[], closed = false): string {
  if (!points.length) return "";
  let d = `M${points[0].x.toFixed(4)} ${points[0].y.toFixed(4)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L${points[i].x.toFixed(4)} ${points[i].y.toFixed(4)}`;
  }
  if (closed) d += " Z";
  return d;
}

export function rotatePoint(p: Point, a: number): Point {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function translatePoint(p: Point, dx: number, dy: number): Point {
  return { x: p.x + dx, y: p.y + dy };
}

// --- involute -----------------------------------------------------------

// Involute angle of a point on the involute at parameter t.
// At parameter t (the roll angle on the base circle): r = rb/cos(t),
// and the angular position relative to the involute origin is inv(t) = tan(t) - t.
export function inv(t: number): number {
  return Math.tan(t) - t;
}

// Inverse: given desired radius r and base radius rb, return parameter t
// such that rb/cos(t) = r. Returns 0 if r <= rb.
export function involuteParamForRadius(rb: number, r: number): number {
  if (r <= rb) return 0;
  return Math.acos(clamp(rb / r, -1, 1));
}

// --- single tooth construction (external) -------------------------------

type ToothTemplate = {
  rightFlank: Point[]; // from base outward toward tip
  leftFlank: Point[]; // mirror; from tip back toward base
  tipArcStart: Point; // end of right flank at tip
  tipArcEnd: Point; // start of left flank at tip
  rootArcStart: Point; // end of left flank at base/root
  rootArcEnd: Point; // start of next tooth's right flank at base/root
  rb: number;
  ra: number;
  rf: number;
  pitchAngle: number;
  toothCenterAngle: number; // = 0 (centerline along +x)
};

function buildExternalToothTemplate(params: GearParams, samplesPerFlank = 24): ToothTemplate {
  const { teeth, module: m, pressureAngle: alpha, profileShift: x, addendumCoef: ha, dedendumCoef: hf } = params;
  const rp = (m * teeth) / 2;
  const rb = rp * Math.cos(alpha);
  const ra = rp + m * (ha + x);
  const rf = Math.max(0.01, rp - m * (hf - x));
  const pitchAngle = (Math.PI * 2) / teeth;
  // Half-thickness angle of tooth on pitch circle.
  const psiP = (Math.PI / 2 + 2 * x * Math.tan(alpha)) / teeth;
  // Involute angle at pitch circle.
  const invAtPitch = inv(alpha);
  // The right flank (in +y region above tooth centerline at angle 0) reaches
  // angle +psiP at the pitch circle. Going OUTWARD along the involute, the
  // flank curves back toward the centerline, so flank angle = thetaBase - inv(t).
  // Setting angle(t=alpha) = +psiP gives thetaBase = psiP + inv(alpha).
  const thetaBase = psiP + invAtPitch;

  // Determine where the involute starts (at rb if rb>rf, else from rf).
  const tStart = rb >= rf ? 0 : involuteParamForRadius(rb, rf);
  const tEnd = involuteParamForRadius(rb, ra);

  const rightFlank: Point[] = [];
  // If rb > rf, add a radial point at root level first so we connect to root arc.
  if (rb > rf) {
    rightFlank.push(polar(0, 0, rf, thetaBase));
  }
  for (let i = 0; i <= samplesPerFlank; i += 1) {
    const t = tStart + (i / samplesPerFlank) * (tEnd - tStart);
    const r = rb / Math.cos(t);
    const a = thetaBase - inv(t);
    rightFlank.push(polar(0, 0, r, a));
  }

  const leftFlank: Point[] = rightFlank.map((p) => ({ x: p.x, y: -p.y }));
  // Reverse so left flank goes from tip back down to root, matching outline traversal order.
  leftFlank.reverse();

  return {
    rightFlank,
    leftFlank,
    tipArcStart: rightFlank[rightFlank.length - 1],
    tipArcEnd: leftFlank[0],
    rootArcStart: leftFlank[leftFlank.length - 1],
    rootArcEnd: rotatePoint(rightFlank[0], pitchAngle),
    rb,
    ra,
    rf,
    pitchAngle,
    toothCenterAngle: 0,
  };
}

// Sample a circular arc at a fixed radius from angle a0 to a1.
// Direction follows sign of (a1 - a0). Includes endpoints.
function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, segments = 8): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = a0 + (i / segments) * (a1 - a0);
    pts.push(polar(cx, cy, r, a));
  }
  return pts;
}

// Build full external gear outline as a closed polygon.
function buildExternalGearProfile(params: GearParams): { profile: Point[]; rb: number; ra: number; rf: number } {
  const tooth = buildExternalToothTemplate(params);
  const pitch = tooth.pitchAngle;
  const profile: Point[] = [];

  for (let k = 0; k < params.teeth; k += 1) {
    const rot = k * pitch;
    // Right flank base->tip
    const right = tooth.rightFlank.map((p) => rotatePoint(p, rot));
    // Tip arc: from right flank tip to left flank tip, sweeping around tooth centerline
    const tipStart = rotatePoint(tooth.tipArcStart, rot);
    const tipEnd = rotatePoint(tooth.tipArcEnd, rot);
    const tipStartA = Math.atan2(tipStart.y, tipStart.x);
    const tipEndA = Math.atan2(tipEnd.y, tipEnd.x);
    // We want the arc to sweep through the tooth centerline (angle = rot, from +psi to -psi).
    let dA = tipEndA - tipStartA;
    if (dA > Math.PI) dA -= 2 * Math.PI;
    if (dA < -Math.PI) dA += 2 * Math.PI;
    const tip = arcPoints(0, 0, tooth.ra, tipStartA, tipStartA + dA, 4);
    // Left flank tip->base
    const left = tooth.leftFlank.map((p) => rotatePoint(p, rot));
    // Root arc from this tooth's left base to next tooth's right base
    const rootStart = rotatePoint(tooth.rootArcStart, rot);
    const rootEnd = rotatePoint(tooth.rootArcEnd, rot);
    const rootStartA = Math.atan2(rootStart.y, rootStart.x);
    const rootEndA = Math.atan2(rootEnd.y, rootEnd.x);
    let rdA = rootEndA - rootStartA;
    if (rdA <= 0) rdA += 2 * Math.PI;
    const root = arcPoints(0, 0, tooth.rf, rootStartA, rootStartA + rdA, 4);

    // Append (drop duplicate first points between segments)
    if (k === 0) {
      profile.push(...right);
    } else {
      profile.push(...right.slice(1));
    }
    profile.push(...tip.slice(1));
    profile.push(...left.slice(1));
    profile.push(...root.slice(1));
  }

  return { profile, rb: tooth.rb, ra: tooth.ra, rf: tooth.rf };
}

// --- internal gear ------------------------------------------------------

// For an internal gear, the tooth points INWARD: tip at ra (smaller than rp),
// root at rf (larger than rp). Flanks are involutes (still r >= rb).
// We trace the inner profile (tooth/gap pattern) here. The outer rim is a
// separate circle returned by the caller.
//
// For internal gears the tooth THICKENS outward (from tip toward root). The
// involute angle relationship is: flank angle at radius r = thetaBase + inv(τ_r),
// where thetaBase = psiP − inv(α) and psiP is the half-thickness on pitch.
function buildInternalGearProfile(params: GearParams): { profile: Point[]; rb: number; ra: number; rf: number } {
  const { teeth, module: m, pressureAngle: alpha, profileShift: x, addendumCoef: ha, dedendumCoef: hf } = params;
  const rp = (m * teeth) / 2;
  const rb = rp * Math.cos(alpha);
  // For internal, ha pulls tip inward, hf pushes root outward.
  const ra = Math.max(rb * 0.5, rp - m * (ha - x));
  const rf = rp + m * (hf + x);
  const pitchAngle = (Math.PI * 2) / teeth;

  const psiP = (Math.PI / 2 + 2 * x * Math.tan(alpha)) / teeth;
  const invAtPitch = inv(alpha);
  const thetaBase = psiP - invAtPitch;

  const samples = 24;
  // Involute params at root and tip.
  const tRoot = involuteParamForRadius(rb, rf); // always > 0 since rf > rb
  const tTip = ra >= rb ? involuteParamForRadius(rb, ra) : 0;

  // Build right flank from tip (small r) outward to root (large r).
  const right: Point[] = [];
  if (ra < rb) {
    // Tip is inside base circle: radial line from (ra, thetaBase) to (rb, thetaBase),
    // then involute from rb outward to rf.
    right.push(polar(0, 0, ra, thetaBase));
    for (let i = 0; i <= samples; i += 1) {
      const t = (i / samples) * tRoot;
      const r = rb / Math.cos(t);
      const a = thetaBase + inv(t);
      right.push(polar(0, 0, r, a));
    }
  } else {
    // Tip is at or outside base circle: involute from t=tTip up to t=tRoot.
    for (let i = 0; i <= samples; i += 1) {
      const t = tTip + (i / samples) * (tRoot - tTip);
      const r = rb / Math.cos(t);
      const a = thetaBase + inv(t);
      right.push(polar(0, 0, r, a));
    }
  }
  // Left flank: mirror across centerline (y → −y), then reverse traversal so it
  // also goes "from one end to the other" but the opposite direction.
  const left = right.map((p) => ({ x: p.x, y: -p.y })).reverse();

  // Tip half-angle (where the right flank starts, on the tip side):
  const tipPoint = right[0];
  const tipHalfAngle = Math.atan2(tipPoint.y, tipPoint.x);

  // Root angle (where the right flank ends):
  const rootPoint = right[right.length - 1];
  const rootEndA = Math.atan2(rootPoint.y, rootPoint.x);
  // The next tooth's left flank ends (root side) at angle pitchAngle - rootEndA
  // measured CCW; equivalently rotate this tooth's left flank end by pitchAngle.
  const leftRootPoint = left[left.length - 1]; // last point of left flank — root side, mirrored
  const leftRootA = Math.atan2(leftRootPoint.y, leftRootPoint.x); // = -rootEndA
  // Root arc spans from rootEndA forward (CCW) to (leftRootA + pitchAngle).
  let rootSweep = (leftRootA + pitchAngle) - rootEndA;
  if (rootSweep < 0) rootSweep += 2 * Math.PI;

  // Tip arc spans from leftTipA to rightTipA (sweeping CCW through 0 across the
  // tooth centerline). Right tip is the FIRST point of `right`; left tip is the
  // LAST point of `left` reversed... wait we set left = mirror(right).reverse(),
  // so left[0] = mirror(right[last]) and left[last] = mirror(right[0]).
  // For traversal we want: start at LEFT-FLANK ROOT end of previous tooth's
  // root arc → traverse left flank from root TO tip → tip arc → right flank
  // from tip to root → root arc to next tooth.
  // Currently `right` is tip→root; flip to root→tip for traversal? Easier: we
  // arrange the polygon as: (root arc) → (right flank: root→tip) → (tip arc)
  // → (left flank: tip→root) → (root arc to next tooth) ...
  // So we need right reversed (root→tip) and left as-built (tip→root after mirror+reverse → that's actually root→tip... confusing). Let's define explicitly.
  const rightRootToTip = [...right].reverse(); // now [0]=root, [last]=tip
  const leftTipToRoot = right.map((p) => ({ x: p.x, y: -p.y })); // [0]=tip(mirror of right[0]), [last]=root(mirror of right[last])

  const tipPointRight = rightRootToTip[rightRootToTip.length - 1]; // == right[0]
  const tipPointLeft = leftTipToRoot[0]; // mirror of right[0]
  const tipRightA = Math.atan2(tipPointRight.y, tipPointRight.x); // = +tipHalfAngle
  const tipLeftA = Math.atan2(tipPointLeft.y, tipPointLeft.x); // = -tipHalfAngle
  // Tip arc from rightTipA forward toward leftTipA, sweeping through 0.
  // We want a SHORT arc (across the tooth tip), so go from tipRightA backward
  // to tipLeftA: sweep = tipLeftA - tipRightA (which is negative since tipLeftA < tipRightA).
  let tipSweep = tipLeftA - tipRightA;
  if (tipSweep > 0) tipSweep -= 2 * Math.PI; // ensure we sweep through 0 in CW direction

  void tipHalfAngle; // (kept for clarity above)

  const profile: Point[] = [];
  for (let k = 0; k < teeth; k += 1) {
    const rot = k * pitchAngle;
    // root arc of THIS pitch slot: from previous tooth's left-flank-root end to this tooth's right-flank-root start
    // For k=0, start the polygon at this tooth's right-flank-root start.
    const rRtoT = rightRootToTip.map((p) => rotatePoint(p, rot));
    const lTtoR = leftTipToRoot.map((p) => rotatePoint(p, rot));
    const tip = arcPoints(0, 0, ra, tipRightA + rot, tipRightA + rot + tipSweep, 4);
    const root = arcPoints(0, 0, rf, rootEndA + rot, rootEndA + rot + rootSweep, 4);

    if (k === 0) {
      profile.push(...rRtoT);
    } else {
      profile.push(...rRtoT.slice(1));
    }
    profile.push(...tip.slice(1));
    profile.push(...lTtoR.slice(1));
    profile.push(...root.slice(1));
  }

  return { profile, rb, ra, rf };
}

// --- public gear builder ------------------------------------------------

export function buildGear(params: GearParams): GearGeometry {
  const warnings: string[] = [];
  if (params.teeth < 4) warnings.push("Tooth count below 4 — geometry will be unusable.");
  if (params.module <= 0) warnings.push("Module must be positive.");
  if (params.pressureAngle <= 0 || params.pressureAngle >= Math.PI / 2) warnings.push("Pressure angle out of range.");

  const rp = (params.module * params.teeth) / 2;
  const rb = rp * Math.cos(params.pressureAngle);

  let outerProfile: Point[];
  let rimCircleRadius: number | null = null;
  let outsideRadius: number;
  let rootRadius: number;
  let rimRadius: number;

  if (params.kind === "external") {
    const built = buildExternalGearProfile(params);
    outerProfile = built.profile;
    outsideRadius = built.ra;
    rootRadius = built.rf;
    rimRadius = built.ra;
  } else {
    const built = buildInternalGearProfile(params);
    outerProfile = built.profile;
    outsideRadius = built.ra;
    rootRadius = built.rf;
    const rimPad = Math.max(params.module * 2.5, 4);
    rimRadius = (params.rimDiameter ?? 0) > 0 ? (params.rimDiameter ?? 0) / 2 : built.rf + rimPad;
    rimCircleRadius = rimRadius;
    if (rimRadius < built.rf + 0.5) {
      warnings.push("Rim diameter is too small; clamped above root.");
      rimCircleRadius = built.rf + rimPad;
      rimRadius = rimCircleRadius;
    }
  }

  return {
    params,
    pitchRadius: rp,
    baseRadius: rb,
    outsideRadius,
    rootRadius,
    rimRadius,
    outerProfile,
    rimCircleRadius,
    toothPolygon: outerProfile.slice(0, Math.max(2, Math.floor(outerProfile.length / params.teeth))),
    warnings,
  };
}

// --- mesh validation ----------------------------------------------------

export type MeshCheck = {
  ok: boolean;
  reason?: string;
  centerDistance: number; // mm
};

export function checkMesh(central: GearParams, planet: GearParams): MeshCheck {
  if (planet.kind !== "external") {
    return { ok: false, reason: "Planet must be external.", centerDistance: 0 };
  }
  if (central.kind !== "internal" && central.kind !== "external") {
    return { ok: false, reason: "Central gear must be internal (hypotrochoid) or external (epitrochoid).", centerDistance: 0 };
  }
  if (Math.abs(central.module - planet.module) > 1e-6) {
    return { ok: false, reason: "Modules do not match.", centerDistance: 0 };
  }
  if (Math.abs(central.pressureAngle - planet.pressureAngle) > 1e-6) {
    return { ok: false, reason: "Pressure angles do not match.", centerDistance: 0 };
  }
  if (central.kind === "internal" && planet.teeth >= central.teeth) {
    return { ok: false, reason: "Planet must have fewer teeth than internal ring.", centerDistance: 0 };
  }
  // Internal mesh: center distance = (R − r)·m/2; external mesh: (R + r)·m/2.
  const sign = central.kind === "internal" ? -1 : 1;
  const center = (central.module * (central.teeth + sign * planet.teeth)) / 2;
  return { ok: true, centerDistance: center };
}

// --- trochoid math ------------------------------------------------------
// For a planet of pitch radius r rolling INSIDE a ring of pitch radius R,
// a pen at distance d from the planet center traces a hypotrochoid.
// (Outside rolling traces an epitrochoid.)
//
// Returns curve points in pitch-radius units (NOT mm; multiply by module/2 if needed).

export type TrochoidMode = "inside" | "outside";

export function hypotrochoidPoint(R: number, r: number, d: number, t: number): Point {
  return {
    x: (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t),
    y: (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t),
  };
}

export function epitrochoidPoint(R: number, r: number, d: number, t: number): Point {
  return {
    x: (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t),
    y: (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t),
  };
}

export type TrochoidInput = {
  ringTeeth: number;
  planetTeeth: number;
  module: number; // mm/tooth — same on both gears
  penOffsetFraction: number; // 0..~1.2; offset = penOffsetFraction * planet pitch radius
  mode: TrochoidMode;
  phase: number; // radians, initial phase
  samples: number; // total samples across full closure
};

export type TrochoidCurve = {
  points: Point[]; // in mm, centered (drawing frame)
  R: number; // ring pitch radius mm
  r: number; // planet pitch radius mm
  d: number; // pen offset mm
  loops: number; // number of planet revolutions to close
  maxT: number; // total t span
};

export function buildTrochoid(input: TrochoidInput): TrochoidCurve {
  const R = (input.module * input.ringTeeth) / 2;
  const r = (input.module * input.planetTeeth) / 2;
  const d = input.penOffsetFraction * r;
  const common = gcd(input.ringTeeth, input.planetTeeth);
  const loops = input.planetTeeth / common; // revolutions of planet to close
  const maxT = Math.PI * 2 * loops;

  const fn = input.mode === "inside" ? hypotrochoidPoint : epitrochoidPoint;
  const points: Point[] = [];
  for (let i = 0; i <= input.samples; i += 1) {
    const t = (i / input.samples) * maxT + input.phase;
    points.push(fn(R, r, d, t));
  }
  return { points, R, r, d, loops, maxT };
}

// Position of planet center at parameter t (mm).
export function planetCenter(R: number, r: number, mode: TrochoidMode, t: number): Point {
  const dist = mode === "inside" ? R - r : R + r;
  return { x: dist * Math.cos(t), y: dist * Math.sin(t) };
}

// Rotation of planet (radians) at parameter t.
export function planetRotation(R: number, r: number, mode: TrochoidMode, t: number): number {
  return mode === "inside" ? -((R - r) / r) * t : (((R + r) / r) * t + Math.PI);
}

// --- pen hole layout (shared by SVG kit + STL export) ------------------

export type PenHolePos = {
  x: number; // mm in planet local frame
  y: number;
  offsetFraction: number; // r / pitchRadius
  radiusMm: number;
};

// Position pen holes on a planet. Holes spiral from the bore outward, capped
// inside the root circle (so a hole never falls in a tooth gap) AND at 80% of
// the pitch radius (so the outermost hole isn't pushed against the rim).
export function planetPenHolePositions(planet: GearGeometry, count: number, holeDiameter: number): PenHolePos[] {
  if (count <= 0) return [];
  const holeR = holeDiameter / 2;
  const innerLimit = Math.max(planet.params.boreDiameter / 2 + holeR + 2, planet.pitchRadius * 0.18);
  const rootGuard = planet.rootRadius - holeR - 1.5;
  const outerLimit = Math.max(innerLimit + 2 * holeR, Math.min(rootGuard, planet.pitchRadius * 0.8));
  const sweepDeg = Math.min(150, 14 * count);
  const sweepRad = (sweepDeg * Math.PI) / 180;
  const out: PenHolePos[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const r = innerLimit + t * (outerLimit - innerLimit);
    const a = -Math.PI / 2 + (t - 0.5) * sweepRad;
    out.push({
      x: r * Math.cos(a),
      y: r * Math.sin(a),
      offsetFraction: r / planet.pitchRadius,
      radiusMm: holeR,
    });
  }
  return out;
}

// --- self-tests --------------------------------------------------------

export function runGearMathSelfTest(): { passed: number; failed: number; failures: string[] } {
  const failures: string[] = [];
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  check("gcd(96,36)=12", gcd(96, 36) === 12);
  check("fraction(96,36)=8:3", fraction(96, 36) === "8:3");
  check("clamp(120,0,100)=100", clamp(120, 0, 100) === 100);
  check("inv(0)=0", Math.abs(inv(0)) < 1e-10);
  check("inv(α=20°)≈0.0149", Math.abs(inv(20 * DEG) - 0.014904) < 1e-4);

  const g = buildGear({
    kind: "external",
    teeth: 24,
    module: 2,
    pressureAngle: 20 * DEG,
    profileShift: 0,
    addendumCoef: 1,
    dedendumCoef: 1.25,
    boreDiameter: 5,
  });
  check("external pitch radius = m·z/2 = 24", Math.abs(g.pitchRadius - 24) < 1e-9);
  check("external base radius = pitch · cos α", Math.abs(g.baseRadius - 24 * Math.cos(20 * DEG)) < 1e-9);
  check("external outside radius = pitch + module = 26", Math.abs(g.outsideRadius - 26) < 1e-9);
  check("external root radius = pitch − 1.25·module = 21.5", Math.abs(g.rootRadius - 21.5) < 1e-9);
  check("external profile is non-empty", g.outerProfile.length > 100);
  // All profile points should sit between rf and ra (inclusive, with small tolerance).
  const inRange = g.outerProfile.every((p) => {
    const r = Math.hypot(p.x, p.y);
    return r >= g.rootRadius - 0.01 && r <= g.outsideRadius + 0.01;
  });
  check("external profile points all within [rf, ra]", inRange);

  const ring = buildGear({
    kind: "internal",
    teeth: 96,
    module: 2,
    pressureAngle: 20 * DEG,
    profileShift: 0,
    addendumCoef: 1,
    dedendumCoef: 1.25,
    boreDiameter: 0,
  });
  check("internal pitch radius = 96", Math.abs(ring.pitchRadius - 96) < 1e-9);
  // For internal gear: ra (tip, inward) = rp − m·(ha − x) = 96 − 2 = 94
  check("internal outside radius (tip, inward) = 94", Math.abs(ring.outsideRadius - 94) < 1e-9);
  check("internal root radius (outward) = 98.5", Math.abs(ring.rootRadius - 98.5) < 1e-9);
  check("internal rim circle present", ring.rimCircleRadius !== null);
  check("internal profile has many points", ring.outerProfile.length > 200);

  const mesh = checkMesh(ring.params, g.params);
  check("mesh OK for matching modules", mesh.ok);
  check("mesh center distance = 72", Math.abs(mesh.centerDistance - 72) < 1e-9);

  const tro = buildTrochoid({
    ringTeeth: 96,
    planetTeeth: 36,
    module: 2,
    penOffsetFraction: 0.5,
    mode: "inside",
    phase: 0,
    samples: 600,
  });
  check("trochoid sampled fully", tro.points.length === 601);
  check("trochoid closes after 3 planet revs (gcd=12, 36/12=3)", tro.loops === 3);

  return { passed, failed, failures };
}
