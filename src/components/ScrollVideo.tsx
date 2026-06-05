"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import manifest from "@/../public/frames/manifest.json";
import { OverlaySections } from "./ScrollVideoOverlays";

/**
 * Apple-style scroll-scrubbed cinematic canvas player.
 *
 * Architecture (the part that makes it butter-smooth):
 *  - The canvas is a single FIXED, full-screen layer. It never moves; only its
 *    pixels change. A separate tall spacer supplies the scroll distance, so
 *    there is no GSAP element-pinning to fight with.
 *  - Frames are pre-extracted WebP images (scripts/extract-frames.mjs). We
 *    DECODE each one (img.decode()) before treating it as drawable so drawImage
 *    never stalls the main thread mid-scroll.
 *  - A GSAP ScrollTrigger with `scrub` animates a single numeric proxy
 *    (frame.n). On every tick we draw the rounded current frame. scrub gives
 *    the inertia; decoded frames give the smoothness.
 */

const MOBILE_BREAKPOINT = 768;
const MAX_DPR = 2;

type DeviceSet = "desktop" | "mobile";

function pickSet(width: number): DeviceSet {
  return width < MOBILE_BREAKPOINT ? "mobile" : "desktop";
}

function framePath(set: DeviceSet, i: number): string {
  return `/frames/${set}/frame_${String(i + 1).padStart(4, "0")}.webp`;
}

interface ScrollVideoProps {
  /** Height of the scroll track in vh. More = slower, airier scrub. */
  trackVh?: number;
}

export default function ScrollVideo({ trackVh = 500 }: ScrollVideoProps) {
  const { count } = manifest;

  const trackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Decoded frames for the active device set (ImageBitmap is fastest to draw;
  // we fall back to HTMLImageElement if createImageBitmap is unavailable).
  const framesRef = useRef<(ImageBitmap | HTMLImageElement | undefined)[]>([]);
  const currentSetRef = useRef<DeviceSet | null>(null);
  const lastDrawnRef = useRef<number>(-1);
  const frameStateRef = useRef({ n: 0 }); // the value GSAP scrubs

  const [firstReady, setFirstReady] = useState(false); // first frame drawable
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // ---------------------------------------------------------------------------
  // Drawing — object-fit: cover, DPR-capped. Pure, reads from refs only.
  // ---------------------------------------------------------------------------
  function draw(index: number, force = false) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const clamped = Math.max(0, Math.min(count - 1, index));
    if (!force && clamped === lastDrawnRef.current) return;

    const frame = framesRef.current[clamped];
    if (!frame) return; // not decoded yet — leave previous frame on screen

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const pxW = Math.round(canvas.clientWidth * dpr);
    const pxH = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }

    const iw = "width" in frame ? frame.width : (frame as HTMLImageElement).naturalWidth;
    const ih = "height" in frame ? frame.height : (frame as HTMLImageElement).naturalHeight;
    const scale = Math.max(pxW / iw, pxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (pxW - dw) / 2;
    const dy = (pxH - dh) / 2;

    ctx.drawImage(frame as CanvasImageSource, dx, dy, dw, dh);
    lastDrawnRef.current = clamped;
  }

  // ---------------------------------------------------------------------------
  // Load + decode a device set. Decodes frame 0 first so we paint instantly,
  // then streams the rest in order. The experience starts as soon as frame 0
  // is ready — no waiting for the whole set.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function decodeOne(set: DeviceSet, i: number) {
      try {
        const res = await fetch(framePath(set, i));
        const blob = await res.blob();
        if (cancelled || currentSetRef.current !== set) return;
        if ("createImageBitmap" in window) {
          framesRef.current[i] = await createImageBitmap(blob);
        } else {
          const img = new Image();
          img.src = URL.createObjectURL(blob);
          await img.decode().catch(() => {});
          framesRef.current[i] = img;
        }
      } catch {
        // skip a bad frame; never deadlock the loader
      }
    }

    async function loadSet(set: DeviceSet) {
      currentSetRef.current = set;
      lastDrawnRef.current = -1;
      framesRef.current = new Array(count);
      setFirstReady(false);

      const startIndex = reducedMotion ? Math.floor(count / 2) : 0;

      // 1. Decode the starting frame first and paint it immediately.
      await decodeOne(set, startIndex);
      if (cancelled || currentSetRef.current !== set) return;
      draw(startIndex, true);
      frameStateRef.current.n = startIndex;
      setFirstReady(true);

      // 2. Stream the rest, in scroll order, a few in flight at a time.
      const CONCURRENCY = 6;
      const queue: number[] = [];
      for (let i = 0; i < count; i++) if (i !== startIndex) queue.push(i);

      async function worker() {
        while (queue.length && !cancelled && currentSetRef.current === set) {
          const i = queue.shift()!;
          await decodeOne(set, i);
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    }

    loadSet(pickSet(window.innerWidth));

    let resizeRaf: number | null = null;
    const onResize = () => {
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        const next = pickSet(window.innerWidth);
        if (next !== currentSetRef.current) {
          loadSet(next);
        } else {
          draw(lastDrawnRef.current >= 0 ? lastDrawnRef.current : 0, true);
          ScrollTrigger.refresh();
        }
      });
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, reducedMotion]);

  // ---------------------------------------------------------------------------
  // Scroll wiring — Lenis + a scrubbed numeric proxy. Skipped under reduced motion.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (reducedMotion || !firstReady) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({ lerp: 0.1 });
    lenis.on("scroll", ScrollTrigger.update);
    const tickerCb = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tickerCb);
    gsap.ticker.lagSmoothing(0);

    const state = frameStateRef.current;

    // Animate the frame number across the whole track, scrubbed. We draw on
    // every tick (onUpdate of the tween) so the canvas tracks the eased value,
    // not the raw scroll position — this is what reads as "video playback".
    const tween = gsap.to(state, {
      n: count - 1,
      ease: "none",
      scrollTrigger: {
        trigger: trackRef.current,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.6,
        invalidateOnRefresh: true,
      },
      onUpdate: () => draw(Math.round(state.n)),
    });

    draw(Math.round(state.n), true);
    ScrollTrigger.refresh();

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
      gsap.ticker.remove(tickerCb);
      lenis.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstReady, reducedMotion, count]);

  // Reduced motion: keep a static midpoint frame painted across resizes.
  useEffect(() => {
    if (!reducedMotion || !firstReady) return;
    const mid = Math.floor(count / 2);
    draw(mid, true);
    const onResize = () => draw(mid, true);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, firstReady, count]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Fixed, full-screen canvas layer shared by both modes.
  const canvasLayer = (
    <div className="fixed inset-0 z-0 h-svh w-full bg-black">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {!firstReady && <Loader />}
    </div>
  );

  if (reducedMotion) {
    return (
      <section className="relative w-full">
        {canvasLayer}
        <div className="relative z-10">
          <OverlaySections reducedMotion />
        </div>
      </section>
    );
  }

  return (
    <>
      {canvasLayer}
      {/* Overlays sit fixed over the canvas; the spacer below drives scroll. */}
      <div className="pointer-events-none fixed inset-0 z-10 h-svh w-full">
        <OverlaySections />
      </div>
      {/* Tall scroll track — the only thing that actually scrolls here. */}
      <section
        ref={trackRef}
        data-scroll-track
        className="relative z-0 w-full"
        style={{ height: `${trackVh}vh` }}
        aria-hidden
      />
    </>
  );
}

function Loader() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-black text-white">
      <div className="mb-4 text-[0.7rem] font-light uppercase tracking-[0.4em] text-white/50">
        Loading
      </div>
      <div className="h-5 w-5 animate-spin rounded-full border border-white/20 border-t-white/80" />
    </div>
  );
}
