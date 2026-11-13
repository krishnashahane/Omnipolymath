/* oxlint-disable unicorn/no-array-fill-with-reference-type -- CanvasRenderingContext2D.fill is not Array.fill. */
// Canvas rendering for the Omnipolymath mark: a shield with a check, drawn in a
// 120x120 art box. Mood poses still drive tilt, stretch, the check's brightness
// and the celebration effects, so the mark stays alive without a mascot.
import {
  clampMascotValue as clamp,
  mascotBell as bell,
  type MascotPalette,
  type MascotPose,
} from "./mascot-pose.ts";

const ART_SIZE = 120;
const EYE_GLOW = "#00e5cc";
const HAT_AMBER = "#f2a833";
const SHIELD = "M60 12 98 26v28c0 23-15.5 41.5-38 51C37.5 95.5 22 77 22 54V26Z";
const CHECK = "m43 59 12 12 23-23";

type Point = { x: number; y: number };

let cachedPaths: { shield: Path2D; check: Path2D } | null = null;

function markPaths() {
  cachedPaths ??= { shield: new Path2D(SHIELD), check: new Path2D(CHECK) };
  return cachedPaths;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function sparklePath(center: Point, size: number): Path2D {
  const path = new Path2D();
  path.moveTo(center.x, center.y - size);
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const) {
    path.quadraticCurveTo(center.x, center.y, center.x + size * dx, center.y + size * dy);
  }
  path.closePath();
  return path;
}

function drawEffect(ctx: CanvasRenderingContext2D, pose: MascotPose, palette: MascotPalette): void {
  switch (pose.effect) {
    case "none":
      return;
    case "sparkles":
      for (let index = 0; index < 6; index += 1) {
        const phase = (pose.effectPhase + index * 0.37) % 1;
        const alpha = bell(phase);
        if (alpha <= 0.05) {
          continue;
        }
        const angle = Math.PI + (Math.PI * (index + 0.5)) / 6;
        const center = {
          x: 60 + Math.cos(angle) * (50 + (index % 3) * 4),
          y: 55 + Math.sin(angle) * (40 + ((index * 5) % 3) * 4),
        };
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.fillStyle = index % 2 === 0 ? EYE_GLOW : palette.antenna;
        ctx.fill(sparklePath(center, 2.5 + 2 * alpha));
        ctx.restore();
      }
      return;
    case "zzz":
      for (let index = 0; index < 3; index += 1) {
        const phase = (pose.effectPhase + index * 0.33) % 1;
        const alpha = phase < 0.2 ? phase / 0.2 : 1 - (phase - 0.2) / 0.8;
        if (alpha <= 0.05) {
          continue;
        }
        const position: Point = {
          x: 86 + 14 * phase + 2 * Math.sin(phase * 4 * Math.PI),
          y: 24 - 20 * phase,
        };
        const size = 6 + 4 * phase;
        const path = new Path2D();
        const width = size * 0.62;
        const height = size * 0.78;
        path.moveTo(position.x - width / 2, position.y - height / 2);
        path.lineTo(position.x + width / 2, position.y - height / 2);
        path.lineTo(position.x - width / 2, position.y + height / 2);
        path.lineTo(position.x + width / 2, position.y + height / 2);
        ctx.save();
        ctx.globalAlpha *= alpha * 0.9;
        ctx.strokeStyle = EYE_GLOW;
        ctx.lineWidth = Math.max(1.2, size * 0.16);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke(path);
        ctx.restore();
      }
      return;
    case "sparks":
      for (let index = 0; index < 5; index += 1) {
        const rawPhase = pose.effectPhase - index * 0.025;
        if (rawPhase < 0 || rawPhase >= 0.45) {
          continue;
        }
        const alpha = rawPhase < 0.08 ? rawPhase / 0.08 : 1 - (rawPhase - 0.08) / 0.37;
        const angle = radians(-160 + index * 35);
        const radius = 5 + (12 * rawPhase) / 0.45;
        const particleSize = 2.2 + (index % 3) * 0.8;
        const center = {
          x: clamp(106 + Math.cos(angle) * radius, particleSize, ART_SIZE - particleSize),
          y: clamp(66 + Math.sin(angle) * radius, particleSize, ART_SIZE - particleSize),
        };
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.fillStyle = index % 2 === 0 ? EYE_GLOW : HAT_AMBER;
        ctx.fill(sparklePath(center, particleSize));
        ctx.restore();
      }
      return;
    case "sweat": {
      const alpha = bell(pose.effectPhase);
      if (alpha <= 0.02) {
        return;
      }
      const center = { x: 42, y: 24 + 7 * pose.effectPhase };
      const drop = new Path2D();
      drop.moveTo(center.x, center.y - 3);
      drop.bezierCurveTo(
        center.x - 4,
        center.y + 1,
        center.x - 2,
        center.y + 3,
        center.x,
        center.y + 3,
      );
      drop.bezierCurveTo(
        center.x + 2,
        center.y + 3,
        center.x + 4,
        center.y + 1,
        center.x,
        center.y - 3,
      );
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.fillStyle = "#80d4ff";
      ctx.fill(drop);
      ctx.restore();
    }
  }
}

/** Draw one pose. Whole-mark float is applied by the host to avoid canvas clipping. */
export function drawMascot(
  pose: MascotPose,
  palette: MascotPalette,
  ctx: CanvasRenderingContext2D,
  size: number,
): void {
  const paths = markPaths();
  ctx.save();
  ctx.scale(size / ART_SIZE, size / ART_SIZE);

  if (pose.bodyStretch !== 1) {
    const stretchX = clamp(1 + (1 - pose.bodyStretch) * 0.5, 0.97, 1.03);
    ctx.translate(60, 105);
    ctx.scale(stretchX, pose.bodyStretch);
    ctx.translate(-60, -105);
  }
  if (pose.bodyTilt !== 0) {
    ctx.translate(60, 60);
    ctx.rotate(radians(pose.bodyTilt));
    ctx.translate(-60, -60);
  }

  const fill = ctx.createLinearGradient(22, 12, 98, 105);
  fill.addColorStop(0, palette.gradientTop);
  fill.addColorStop(1, palette.gradientBottom);
  ctx.fillStyle = fill;
  ctx.fill(paths.shield);

  // The check "blinks" with the pose's eyes and dims with its glow.
  const openness = clamp((pose.leftEyeOpenness + pose.rightEyeOpenness) / 2, 0, 1);
  ctx.save();
  ctx.globalAlpha *= clamp(0.45 + 0.55 * pose.eyeGlowOpacity, 0, 1);
  ctx.strokeStyle = palette.check;
  ctx.lineWidth = 7 + 3 * openness;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(paths.check);
  ctx.restore();

  drawEffect(ctx, pose, palette);
  ctx.restore();
}
