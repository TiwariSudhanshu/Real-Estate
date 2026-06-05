import ScrollVideo from "@/components/ScrollVideo";

export default function Home() {
  return (
    <main className="w-full bg-black text-white">
      {/* Pinned, scroll-scrubbed cinematic walkthrough */}
      <ScrollVideo trackVh={400} />

      {/* ===================================================================
          After the pin releases: normal page flow.
          This proves the canvas unpins cleanly and the page scrolls on.
          =================================================================== */}

      {/* EDIT COPY — Property details / spec list */}
      <section className="mx-auto w-full max-w-5xl px-8 py-28 sm:py-36">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.35em] text-white/40">
          The Property
        </p>
        <h2 className="max-w-2xl text-3xl font-extralight leading-tight tracking-tight sm:text-5xl">
          Every detail, considered.
        </h2>

        <dl className="mt-16 grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Residence", "4 bed · 5 bath"],
            ["Interior", "6,200 sq ft"],
            ["Outdoor", "Wraparound terrace"],
            ["Year", "Completed 2025"],
            ["Parking", "Three-car garage"],
            ["Tenure", "Freehold"],
          ].map(([label, value]) => (
            <div key={label} className="border-t border-white/10 pt-5">
              <dt className="text-xs uppercase tracking-[0.25em] text-white/40">
                {label}
              </dt>
              <dd className="mt-2 text-xl font-light tracking-tight text-white/90">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* EDIT COPY — Contact CTA */}
      <section
        id="contact"
        className="border-t border-white/10 px-8 py-28 text-center sm:py-36"
      >
        <h2 className="mx-auto max-w-2xl text-3xl font-extralight leading-tight tracking-tight sm:text-5xl">
          Arrange your private viewing.
        </h2>
        <p className="mx-auto mt-5 max-w-md text-base font-light tracking-wide text-white/60">
          Speak directly with the listing agent to schedule a walkthrough at a
          time that suits you.
        </p>
        <a
          href="mailto:hello@example.com"
          className="mt-10 inline-flex items-center justify-center rounded-full bg-white px-8 py-3 text-sm font-medium uppercase tracking-[0.2em] text-black transition-colors hover:bg-white/80"
        >
          Contact the Agent
        </a>
      </section>

      {/* EDIT COPY — Footer */}
      <footer className="border-t border-white/10 px-8 py-12">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-4 text-xs uppercase tracking-[0.25em] text-white/35 sm:flex-row">
          <span>Luxury Residences</span>
          <span>© {new Date().getFullYear()} — All rights reserved</span>
        </div>
      </footer>
    </main>
  );
}
