// scripts/extract-frames.mjs
//
// Extracts /public/video.webm into two WebP image sequences (desktop + mobile)
// for scroll-scrubbed canvas playback. The .webm is ONLY a source asset for this
// script — the browser never loads it at runtime.
//
// Run with:  node scripts/extract-frames.mjs   (or `npm run frames`)
//
// ffmpeg/ffprobe resolution order:
//   1. Bundled static binaries (@ffmpeg-installer / @ffprobe-installer) if installed.
//   2. ffmpeg/ffprobe on the system PATH.
// If neither is found, we print an install hint and exit non-zero.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "public", "video.webm");
const FRAMES_DIR = path.join(ROOT, "public", "frames");
const DESKTOP_DIR = path.join(FRAMES_DIR, "desktop");
const MOBILE_DIR = path.join(FRAMES_DIR, "mobile");
const MANIFEST = path.join(FRAMES_DIR, "manifest.json");

// --- Long-edge target sizes (px). The source clip is portrait 720x1280, so we
//     scale by the longest edge and never upscale. `desktopWidth`/`mobileWidth`
//     in the manifest report the actual rendered frame WIDTH for the component. ---
const DESKTOP_LONG_EDGE = 1280; // ~720x1280 for the portrait source
const MOBILE_LONG_EDGE = 800; // ~450x800
const DESKTOP_QUALITY = 80;
const MOBILE_QUALITY = 75;

const FPS_PER_SECOND = 6;
const MIN_FRAMES = 150;
const MAX_FRAMES = 300;

function hasOnPath(bin) {
  const probe = spawnSync(bin, ["-version"], { stdio: "ignore", shell: process.platform === "win32" });
  return probe.status === 0;
}

function fail(msg) {
  console.error("\n✖ " + msg + "\n");
  process.exit(1);
}

function humanSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

function dirSize(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = statSync(p);
    total += s.isDirectory() ? dirSize(p) : s.size;
  }
  return total;
}

async function main() {
  // Resolve binaries (dynamic imports happen here so missing optional deps don't crash the module load).
  let ffmpeg = null;
  let ffprobe = null;
  try {
    const m = await import("@ffmpeg-installer/ffmpeg");
    if (m?.default?.path && existsSync(m.default.path)) ffmpeg = m.default.path;
    else if (m?.path && existsSync(m.path)) ffmpeg = m.path;
  } catch {}
  try {
    const m = await import("@ffprobe-installer/ffprobe");
    if (m?.default?.path && existsSync(m.default.path)) ffprobe = m.default.path;
    else if (m?.path && existsSync(m.path)) ffprobe = m.path;
  } catch {}
  if (!ffmpeg && hasOnPath("ffmpeg")) ffmpeg = "ffmpeg";
  if (!ffprobe && hasOnPath("ffprobe")) ffprobe = "ffprobe";

  if (!ffmpeg || !ffprobe) {
    fail(
      "ffmpeg/ffprobe not found.\n\n" +
        "  Easiest fix (bundled binaries, no system install needed):\n" +
        "    npm i -D @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe\n\n" +
        "  Or install system-wide:\n" +
        "    Windows : winget install Gyan.FFmpeg   (or: choco install ffmpeg)\n" +
        "    macOS   : brew install ffmpeg\n" +
        "    Linux   : sudo apt install ffmpeg"
    );
  }

  if (!existsSync(SRC)) {
    fail(`Source video not found at ${SRC}`);
  }

  console.log("ffmpeg :", ffmpeg);
  console.log("ffprobe:", ffprobe);

  // --- Probe duration + dimensions ---
  let duration;
  let srcW;
  let srcH;
  try {
    duration = parseFloat(
      execFileSync(ffprobe, [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        SRC,
      ]).toString().trim()
    );
    const wh = execFileSync(ffprobe, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      SRC,
    ]).toString().trim().split(",");
    srcW = parseInt(wh[0], 10);
    srcH = parseInt(wh[1], 10);
  } catch (e) {
    fail("ffprobe failed to read the video:\n" + (e.stderr?.toString() || e.message));
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    fail("Could not determine a valid video duration.");
  }

  const portrait = srcH >= srcW;
  console.log(`source  : ${srcW}x${srcH} (${portrait ? "portrait" : "landscape"}), ${duration.toFixed(2)}s`);

  // --- Target frame count: ~6 fps, clamped to [150, 300] ---
  const rawCount = Math.round(duration * FPS_PER_SECOND);
  const count = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, rawCount));
  const fps = count / duration; // fps filter value that yields exactly `count` frames
  console.log(`frames  : ${count} (≈${fps.toFixed(2)} fps over ${duration.toFixed(2)}s)`);

  // --- Compute scale filters by long edge, preserving aspect, never upscaling. ---
  // For portrait we constrain height; for landscape we constrain width.
  function scaleFilter(longEdge) {
    if (portrait) {
      // -2 keeps the other dimension even & auto. min(...) clamps so we never upscale.
      return `scale=-2:'min(${longEdge}\\,ih)':flags=lanczos`;
    }
    return `scale='min(${longEdge}\\,iw)':-2:flags=lanczos`;
  }

  // Rendered frame width (for the manifest) given the chosen long edge.
  function renderedWidth(longEdge) {
    if (portrait) {
      const h = Math.min(longEdge, srcH);
      return Math.round((srcW * (h / srcH)) / 2) * 2;
    }
    const w = Math.min(longEdge, srcW);
    return w;
  }

  const desktopWidth = renderedWidth(DESKTOP_LONG_EDGE);
  const mobileWidth = renderedWidth(MOBILE_LONG_EDGE);

  // --- (Re)create output dirs ---
  for (const d of [DESKTOP_DIR, MOBILE_DIR]) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
  }
  if (!existsSync(FRAMES_DIR)) mkdirSync(FRAMES_DIR, { recursive: true });

  function extract(outDir, longEdge, quality, label) {
    const outPattern = path.join(outDir, "frame_%04d.webp");
    const vf = `fps=${fps.toFixed(6)},${scaleFilter(longEdge)}`;
    console.log(`\n→ extracting ${label} set  (vf=${vf}, q=${quality})`);
    const args = [
      "-y",
      "-i", SRC,
      "-vf", vf,
      "-vsync", "0",
      "-c:v", "libwebp",
      "-quality", String(quality),
      "-compression_level", "6",
      "-preset", "picture",
      "-start_number", "1",
      outPattern,
    ];
    const res = spawnSync(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    if (res.status !== 0) {
      fail(`ffmpeg failed on ${label} set:\n` + (res.stderr?.toString() || "unknown error"));
    }
    const produced = readdirSync(outDir).filter((f) => f.endsWith(".webp")).length;
    console.log(`  ${label}: ${produced} frames @ ~${renderedWidth(longEdge)}px wide → ${humanSize(dirSize(outDir))}`);
    return produced;
  }

  const desktopCount = extract(DESKTOP_DIR, DESKTOP_LONG_EDGE, DESKTOP_QUALITY, "desktop");
  const mobileCount = extract(MOBILE_DIR, MOBILE_LONG_EDGE, MOBILE_QUALITY, "mobile");

  // ffmpeg's fps filter can occasionally produce 1 extra/fewer frame depending on
  // rounding; the manifest count is the floor of what both sets actually contain.
  const finalCount = Math.min(desktopCount, mobileCount);

  const manifest = {
    count: finalCount,
    desktopWidth,
    mobileWidth,
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  const totalSize = dirSize(FRAMES_DIR);
  console.log("\n──────────────────────────────────────────────");
  console.log(`✓ manifest written: ${path.relative(ROOT, MANIFEST)}`);
  console.log(`  count        : ${finalCount}`);
  console.log(`  desktopWidth : ${desktopWidth}px`);
  console.log(`  mobileWidth  : ${mobileWidth}px`);
  console.log(`  total size   : ${humanSize(totalSize)}`);
  console.log("──────────────────────────────────────────────\n");
}

main().catch((e) => fail(e.stack || e.message));
