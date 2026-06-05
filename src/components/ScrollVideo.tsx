"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import manifest from "@/../public/frames/manifest.json";
import { OverlaySections } from "./ScrollVideoOverlays";

/**
 * Scroll-scrubbed cinematic canvas player.
 *
 * Frames are pre-extracted WebP images (see scripts/extract-frames.mjs). At
 * runtime we preload them into Image objects and paint the correct one to a
 * <canvas> based on ScrollTrigger progress. The source .webm is never loaded.
 */

const MOBILE_BREAKPOINT = 768;
const MAX_DPR = 2;

type DeviceSet = "desktop" | "mobile";

function pickSet(width: number): DeviceSet {
  return width < MOBILE_BREAKPOINT ? "mobile" : "desktop";
}

function framePath(set: DeviceSet, i: number): string {
  // 1-based, zero-padded to 4 digits — frame_0001.webp
  return `/frames/${set}/frame_${String(i + 1).padStart(4, "0")}.webp`;
}

interface ScrollVideoProps {
  /** Height of the scroll track in vh. More = slower, airier scrub. */
  trackVh?: number;
}

export default function ScrollVideo({ trackVh = 400 }: ScrollVideoProps) {
  const { count } = manifest;

  const trackRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Loaded Image objects for the active device set.
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const currentSetRef = useRef<DeviceSet | null>(null);
  const lastDrawnRef = useRef<number>(-1);
  const rafRef = useRef<number | null>(null);

  const [loadProgress, setLoadProgress] = useState(0); // 0..1
  const [ready, setReady] = useState(false);
  // Lazy init reads the media query once on the client (SSR renders false, then
  // hydration corrects it) so the effect only needs to subscribe to changes —
  // no setState in the effect body.
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // --- prefers-reduced-motion: subscribe to changes ---
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /**
   * Draw a frame to the canvas with object-fit: cover semantics:
   * scale to fill the viewport, center-crop the overflow, never distort.
   */
  const drawFrame = useCallback((index: number) => {
    const canvas = canvasRef.current;
    const img = imagesRef.current[index];
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;

    // Resize backing store only when it actually changes (cheap to check).
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }

    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    // cover: scale so the image fully covers the canvas, crop the rest.
    const scale = Math.max(pxW / iw, pxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (pxW - dw) / 2;
    const dy = (pxH - dh) / 2;

    ctx.clearRect(0, 0, pxW, pxH);
    ctx.drawImage(img, dx, dy, dw, dh);
    lastDrawnRef.current = index;
  }, []);

  /** Schedule a draw on the next animation frame, coalescing redundant calls. */
  const scheduleDraw = useCallback(
    (index: number) => {
      if (index === lastDrawnRef.current) return;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        drawFrame(index);
      });
    },
    [drawFrame]
  );

  // --- Preload frames for the current device set, then mark ready. ---
  // Re-runs when crossing the breakpoint so we swap to the matching resolution.
  useEffect(() => {
    let cancelled = false;

    function loadSet(set: DeviceSet) {
      currentSetRef.current = set;
      lastDrawnRef.current = -1;
      setReady(false);
      setLoadProgress(0);

      const images: HTMLImageElement[] = new Array(count);
      imagesRef.current = images;
      let loaded = 0;
      let firstDrawn = false;

      const midpoint = Math.floor(count / 2);

      const onOne = (i: number) => {
        if (cancelled || currentSetRef.current !== set) return;
        loaded += 1;
        setLoadProgress(loaded / count);

        // Paint the first available frame ASAP so we have something on screen
        // (helps LCP) rather than waiting for the whole set.
        if (!firstDrawn) {
          firstDrawn = true;
          const startIndex = reducedMotion ? midpoint : 0;
          if (images[startIndex]?.complete) scheduleDraw(startIndex);
          else scheduleDraw(i);
        }

        if (loaded >= count) {
          setReady(true);
          // Ensure the correct starting frame is shown.
          drawFrame(reducedMotion ? midpoint : 0);
        }
      };

      for (let i = 0; i < count; i++) {
        const img = new Image();
        // Prioritize the very first frame for fast first paint.
        if (i === 0) {
          img.fetchPriority = "high";
          img.loading = "eager";
        }
        img.onload = () => onOne(i);
        img.onerror = () => onOne(i); // don't deadlock the loader on a bad frame
        img.src = framePath(set, i);
        images[i] = img;
      }
    }

    const set = pickSet(window.innerWidth);
    loadSet(set);

    // Swap sets when crossing the breakpoint.
    let resizeRaf: number | null = null;
    const onResize = () => {
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        const next = pickSet(window.innerWidth);
        if (next !== currentSetRef.current) {
          loadSet(next);
        } else {
          // Same set: just repaint at current size/frame.
          drawFrame(lastDrawnRef.current >= 0 ? lastDrawnRef.current : 0);
        }
      });
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    };
    // reducedMotion affects the starting frame; re-run if it flips.
  }, [count, reducedMotion, drawFrame, scheduleDraw]);

  // --- Scroll wiring: Lenis + ScrollTrigger. Skipped under reduced motion. ---
  useEffect(() => {
    if (reducedMotion || !ready) return;
    if (typeof window === "undefined") return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis();
    lenis.on("scroll", ScrollTrigger.update);

    const tickerCb = (time: number) => {
      // gsap ticker time is in seconds; lenis.raf wants milliseconds.
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tickerCb);
    gsap.ticker.lagSmoothing(0);

    const st = ScrollTrigger.create({
      trigger: trackRef.current,
      start: "top top",
      end: "bottom bottom",
      pin: pinRef.current,
      pinSpacing: false, // the track itself supplies the scroll distance
      scrub: 1,
      onUpdate: (self) => {
        const index = Math.min(
          count - 1,
          Math.round(self.progress * (count - 1))
        );
        scheduleDraw(index);
      },
    });

    // First paint at current scroll position.
    drawFrame(
      Math.min(count - 1, Math.round((st.progress || 0) * (count - 1)))
    );
    ScrollTrigger.refresh();

    return () => {
      st.kill();
      gsap.ticker.remove(tickerCb);
      lenis.destroy();
    };
  }, [ready, reducedMotion, count, drawFrame, scheduleDraw]);

  // --- Reduced motion: paint a single static midpoint frame once ready. ---
  useEffect(() => {
    if (!reducedMotion || !ready) return;
    drawFrame(Math.floor(count / 2));
    const onResize = () => drawFrame(Math.floor(count / 2));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [reducedMotion, ready, count, drawFrame]);

  // ---------------------------------------------------------------------------
  // Reduced-motion layout: static frame + sections stacked as a normal page.
  // ---------------------------------------------------------------------------
  if (reducedMotion) {
    return (
      <section className="relative w-full">
        <div className="sticky top-0 h-screen w-full overflow-hidden bg-black">
          <canvas ref={canvasRef} className="block h-full w-full" />
          {!ready && <Loader progress={loadProgress} />}
        </div>
        <OverlaySections reducedMotion />
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Scrubbed layout: tall track pins the canvas while overlays cross-fade.
  // ---------------------------------------------------------------------------
  return (
    <section
      ref={trackRef}
      data-scroll-track
      className="relative w-full"
      style={{ height: `${trackVh}vh` }}
    >
      <div
        ref={pinRef}
        className="relative left-0 top-0 h-screen w-full overflow-hidden bg-black"
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
        {!ready && <Loader progress={loadProgress} />}
        <OverlaySections />
      </div>
    </section>
  );
}

function Loader({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black text-white">
      <div className="mb-4 text-sm font-light tracking-[0.3em] text-white/60">
        LOADING
      </div>
      <div className="text-4xl font-extralight tabular-nums tracking-tight">
        {pct}%
      </div>
      <div className="mt-6 h-px w-40 overflow-hidden bg-white/15">
        <div
          className="h-full bg-white/80 transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
