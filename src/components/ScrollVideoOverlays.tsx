"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Four text beats overlaid on the pinned canvas. Each fades + translates in as
 * the camera settles within its scroll-progress range, then fades out as
 * scrolling continues. Ranges are expressed as fractions [start, end] of the
 * SAME scroll track that drives the frames (see ScrollVideo trackVh).
 *
 * Under reduced motion we render the beats as a plain vertical stack with no
 * scroll triggers.
 */

interface Beat {
  /** [enter, exit] as fractions of the whole track, 0..1 */
  range: [number, number];
  /** Where the text block sits within the frame */
  position: "center" | "bottom-left" | "bottom" | "center-cta";
  content: React.ReactNode;
}

// ---------------------------------------------------------------------------
// EDIT COPY — all section text lives here. Placeholder luxury-listing copy.
// ---------------------------------------------------------------------------
const BEATS: Beat[] = [
  {
    /* EDIT COPY — Hero / entry */
    range: [0.0, 0.18],
    position: "center",
    content: (
      <>
        <h1 className="text-5xl font-extralight leading-[1.05] tracking-tight sm:text-7xl md:text-8xl">
          A residence
          <br />
          in motion.
        </h1>
        <p className="mt-6 text-base font-light tracking-wide text-white/70 sm:text-lg">
          Scroll to step inside.
        </p>
      </>
    ),
  },
  {
    /* EDIT COPY — Interior feature */
    range: [0.28, 0.48],
    position: "bottom-left",
    content: (
      <>
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.35em] text-white/50">
          The Interior
        </p>
        <h2 className="max-w-xl text-3xl font-light leading-tight tracking-tight sm:text-5xl">
          Open-plan living,
          <br />
          framed in glass.
        </h2>
      </>
    ),
  },
  {
    /* EDIT COPY — Outdoor / terrace */
    range: [0.54, 0.72],
    position: "bottom",
    content: (
      <>
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.35em] text-white/50">
          The Terrace
        </p>
        <h2 className="mx-auto max-w-2xl text-3xl font-light leading-tight tracking-tight sm:text-5xl">
          Indoor and outdoor,
          <br />
          with no line between.
        </h2>
      </>
    ),
  },
  {
    /* EDIT COPY — Close / CTA */
    range: [0.84, 1.0],
    position: "center-cta",
    content: (
      <>
        <h2 className="text-4xl font-extralight leading-tight tracking-tight sm:text-6xl">
          Book a private viewing.
        </h2>
        <p className="mt-5 max-w-md text-base font-light tracking-wide text-white/70">
          By appointment only. Limited availability this season.
        </p>
        <a
          href="#contact"
          className="mt-9 inline-flex items-center justify-center rounded-full border border-white/30 bg-white/5 px-8 py-3 text-sm font-medium uppercase tracking-[0.2em] text-white backdrop-blur-sm transition-colors hover:bg-white hover:text-black"
        >
          Request a Tour
        </a>
      </>
    ),
  },
];

// Position → wrapper + scrim classes.
function positionClasses(position: Beat["position"]): {
  wrapper: string;
  scrim: string;
  align: string;
} {
  switch (position) {
    case "center":
      return {
        wrapper: "items-center justify-center text-center",
        scrim:
          "bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.2)_55%,transparent_80%)]",
        align: "items-center text-center",
      };
    case "bottom-left":
      return {
        wrapper: "items-end justify-start text-left",
        scrim:
          "bg-[linear-gradient(to_top,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0.3)_35%,transparent_70%)]",
        align: "items-start text-left",
      };
    case "bottom":
      return {
        wrapper: "items-end justify-center text-center",
        scrim:
          "bg-[linear-gradient(to_top,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0.3)_35%,transparent_70%)]",
        align: "items-center text-center",
      };
    case "center-cta":
      return {
        wrapper: "items-center justify-center text-center",
        scrim:
          "bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.7)_0%,rgba(0,0,0,0.4)_50%,rgba(0,0,0,0.2)_100%)]",
        align: "items-center text-center",
      };
  }
}

export function OverlaySections({
  reducedMotion = false,
}: {
  reducedMotion?: boolean;
}) {
  // Reduced motion: render beats as a simple stacked, always-visible sequence.
  if (reducedMotion) {
    return (
      <div className="relative z-20 w-full bg-black text-white">
        {BEATS.map((beat, i) => {
          const pos = positionClasses(beat.position);
          return (
            <div
              key={i}
              className={`flex min-h-[60vh] w-full flex-col justify-center px-8 py-16 ${pos.align}`}
            >
              <div className="flex max-w-3xl flex-col">{beat.content}</div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {BEATS.map((beat, i) => (
        <OverlayBeat key={i} beat={beat} />
      ))}
    </div>
  );
}

function OverlayBeat({ beat }: { beat: Beat }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = positionClasses(beat.position);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const track = el.closest<HTMLElement>("[data-scroll-track]");
    if (!track) return;

    gsap.registerPlugin(ScrollTrigger);

    const [enter, exit] = beat.range;
    const span = exit - enter;
    // Fade windows: come in over the first ~35% of the range, hold, fade out
    // over the last ~30%. The hold keeps the copy readable while the camera
    // "settles".
    const inEnd = enter + span * 0.35;
    const outStart = exit - span * 0.3;

    gsap.set(el, { opacity: 0, y: 40 });

    const st = ScrollTrigger.create({
      trigger: track,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: (self) => {
        const p = self.progress;
        let opacity: number;
        let y: number;
        if (p < enter || p > exit) {
          opacity = 0;
          y = p < enter ? 40 : -30;
        } else if (p < inEnd) {
          const t = (p - enter) / (inEnd - enter);
          opacity = t;
          y = 40 * (1 - t);
        } else if (p > outStart) {
          const t = (p - outStart) / (exit - outStart);
          opacity = 1 - t;
          y = -30 * t;
        } else {
          opacity = 1;
          y = 0;
        }
        gsap.set(el, { opacity, y });
      },
    });

    return () => st.kill();
  }, [beat.range]);

  return (
    <div
      ref={ref}
      className={`absolute inset-0 flex p-8 will-change-[opacity,transform] sm:p-16 ${pos.wrapper}`}
    >
      {/* dark scrim for readability over bright frames */}
      <div className={`pointer-events-none absolute inset-0 ${pos.scrim}`} />
      <div className="pointer-events-auto relative flex max-w-3xl flex-col text-white">
        {beat.content}
      </div>
    </div>
  );
}
