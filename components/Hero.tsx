"use client";

import Image, { type StaticImageData } from "next/image";
import { useEffect, useRef } from "react";
import zion from "@/assets/images/zion-national-park.jpg";
import flattops from "@/assets/images/flattops-wilderness-area.jpg";
import teton from "@/assets/images/teton-national-park.jpg";
import glacier from "@/assets/images/glacier-national-park.jpg";

// Scroll parallax: photos drift and turn at different rates while the text lags behind
// and fades. Each layer gets --py (px offset) and --spin (extra rotation), which the CSS
// folds into its transform.
//
// speed: px moved per px scrolled, as [desktop, mobile]. Positive lags the page, negative
// runs ahead of it. The top photos fly off ahead of the page and the bottom ones drift more
// slowly, so the frame opens up as you scroll. Nothing lags, so no photo drifts down over
// the Globe / Timeline toggle below the hero. On mobile the text sits between the photo
// rows and rises a little faster than the bottom row, so they still separate.
// spin: extra degrees of rotation by the time the hero has scrolled away.
type Layer = { speed: [number, number]; spin: number };

const TEXT: Layer = { speed: [0.3, -0.1], spin: 0 };

const PHOTOS: (Layer & { id: string; src: StaticImageData; alt: string; label: string; chip: string })[] = [
  {
    id: "zion",
    src: zion,
    alt: "Looking down into the canyon at Zion National Park",
    label: "Zion National Park",
    chip: "green",
    speed: [-0.3, -0.25],
    spin: -6,
  },
  {
    id: "flattops",
    src: flattops,
    alt: "A lake below a flat-topped mountain in the Flat Tops Wilderness Area",
    label: "Flattops Wilderness Area",
    chip: "orange",
    speed: [-0.2, -0.2],
    spin: 6,
  },
  {
    id: "teton",
    src: teton,
    alt: "Cloud-wrapped peaks above a still mountain lake in Grand Teton National Park",
    label: "Teton National Park",
    chip: "purple",
    speed: [-0.05, -0.04],
    spin: 5,
  },
  {
    id: "glacier",
    src: glacier,
    alt: "Jagged peaks above a forested valley in Glacier National Park",
    label: "Glacier National Park",
    chip: "blue",
    speed: [-0.12, -0.06],
    spin: -5,
  },
];

const PHOTO_SIZES = "(max-width: 900px) 240px, 320px";

export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const photoRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const hero = heroRef.current!;
    const mobile = window.matchMedia("(max-width: 900px)");
    const layers = [
      { el: textRef.current!, ...TEXT, fade: true },
      ...PHOTOS.map((photo, i) => ({ el: photoRefs.current[i]!, ...photo, fade: false })),
    ];
    let frame = 0;

    function update() {
      frame = 0;
      const height = hero.offsetHeight;
      const scrolled = Math.min(Math.max(window.scrollY, 0), height);
      const progress = scrolled / height;
      const i = mobile.matches ? 1 : 0;

      for (const layer of layers) {
        layer.el.style.setProperty("--py", `${(scrolled * layer.speed[i]).toFixed(1)}px`);
        layer.el.style.setProperty("--spin", `${(progress * layer.spin).toFixed(2)}deg`);
        if (layer.fade) layer.el.style.opacity = Math.max(0, 1 - progress * 1.4).toFixed(3);
      }
    }

    function requestUpdate() {
      if (!frame) frame = requestAnimationFrame(update);
    }

    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    mobile.addEventListener("change", requestUpdate);
    update();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      mobile.removeEventListener("change", requestUpdate);
    };
  }, []);

  return (
    <header className="hero" ref={heroRef}>
      <div className="hero-text" ref={textRef}>
        <h1 className="hero-title">Timeline of travels</h1>
        <p className="hero-tagline">
          A map of my explorations
          <br />
          throughout the years
        </p>
        <a className="btn btn-dark hero-cta" href="#globe-section">
          See where I’ve been
        </a>
      </div>

      {PHOTOS.map((photo, i) => (
        <figure
          key={photo.id}
          className={`hero-photo hero-photo--${photo.id}`}
          ref={(el) => {
            photoRefs.current[i] = el;
          }}
        >
          <Image src={photo.src} alt={photo.alt} sizes={PHOTO_SIZES} loading="eager" fetchPriority="high" />
          <figcaption className={`chip chip--${photo.chip}`}>{photo.label}</figcaption>
        </figure>
      ))}
    </header>
  );
}
