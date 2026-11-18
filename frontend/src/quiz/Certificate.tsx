/** The R1 certificate (quiz direction board), redesigned: ornamental frame, medallion score, ink stamp and signature. */
import type { ReactNode } from "react";
import { LogoMark } from "../components/Museum";

const INK = "#7E1D2B"; // stamp ink: the velvet-rope red

/**
 * A rubber ink stamp: a double ring, text running round the rim, the logo in the middle.
 * Two SVG filters rough up the edge and leave speckled gaps, so it reads as pressed ink, not a flat badge.
 */
export function InkStamp({ className = "", rotate = -12 }: { className?: string; rotate?: number }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={`ink-stamp ${className}`}
      style={{ transform: `rotate(${rotate}deg)` }}
      role="img"
      aria-label="Печатка музею «Під склом»"
    >
      <defs>
        <filter id="ink-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="edge" />
          <feDisplacementMap in="SourceGraphic" in2="edge" scale="2.6" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="11" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -8 5.4" result="speckle" />
          <feComposite in="rough" in2="speckle" operator="in" />
        </filter>
        <path id="stamp-top" d="M36 100 A64 64 0 0 1 164 100" />
        <path id="stamp-bottom" d="M25 100 A75 75 0 0 0 175 100" />
      </defs>
      <g filter="url(#ink-rough)" fill={INK} stroke={INK}>
        <circle cx="100" cy="100" r="94" fill="none" strokeWidth="5" />
        <circle cx="100" cy="100" r="86" fill="none" strokeWidth="1.6" />
        <circle cx="100" cy="100" r="50" fill="none" strokeWidth="1.6" />
        <g stroke="none" fontFamily="Manrope, sans-serif" fontWeight="800" letterSpacing="3.5" textAnchor="middle">
          <text fontSize="15"><textPath href="#stamp-top" startOffset="50%">МУЗЕЙ «ПІД СКЛОМ»</textPath></text>
          <text fontSize="13"><textPath href="#stamp-bottom" startOffset="50%">ПОСВІДЧЕННЯ · 2026</textPath></text>
          <circle cx="27" cy="100" r="3.2" /><circle cx="173" cy="100" r="3.2" />
        </g>
        {/* the logo: a pane of glass with a glare */}
        <g fill="none" strokeLinecap="round">
          <rect x="78" y="68" width="44" height="64" strokeWidth="4.5" />
          <path d="M88 112 112 82" strokeWidth="5" />
          <path d="M95 118 114 94" strokeWidth="2.4" />
        </g>
      </g>
    </svg>
  );
}

/** A corner flourish; the four corners are this one drawing, rotated. */
export function CornerOrnament({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`cert-corner max-md:!h-8 max-md:!w-8 ${className}`} fill="none" stroke="currentColor" aria-hidden>
      <path d="M3 61V20Q3 3 20 3H61" strokeWidth="2.2" />
      <path d="M11 61V24Q11 11 24 11H61" strokeWidth="1" />
      <path d="M19 19l6 6-6 6-6-6z" strokeWidth="1.4" fill="currentColor" />
      <path d="M33 11c5 6 11 6 16 0M11 33c6 5 6 11 0 16" strokeWidth="1.2" />
    </svg>
  );
}

/** A thin rule with a diamond in the middle. */
export function OrnamentRule({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 16" className={className} fill="none" stroke="currentColor" aria-hidden>
      <path d="M0 8H98M142 8H240" strokeWidth="1" />
      <path d="M120 2l6 6-6 6-6-6z" strokeWidth="1.4" fill="currentColor" />
      <circle cx="104" cy="8" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="136" cy="8" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The director's signature: a hand-drawn scribble above a rule and the title. */
export function Signature({ title }: { title: ReactNode }) {
  return (
    <div className="w-full max-w-[190px] text-center md:w-[190px]">
      <svg viewBox="0 0 190 44" className="mx-auto block h-11 w-full" fill="none" stroke="#2E2620" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 30C16 8 24 4 28 14c3 9-6 20 2 22 9 2 12-22 20-22 6 0 2 14 8 14 7 0 8-10 14-10 7 0 4 12 11 10 8-2 10-14 18-14 7 0 6 12 14 10 8-2 12-8 20-6" strokeWidth="1.9" />
        <path d="M30 38C70 33 120 33 168 36" strokeWidth="1.1" />
      </svg>
      <div className="border-t border-text/40 pt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-text-secondary">{title}</div>
    </div>
  );
}

/**
 * The certificate sheet. Below the laptop breakpoint it is the vertical certificate (also the layout for the mobile
 * interface); from `lg` up the same blocks are placed on a two-column grid to make a landscape one:
 * header and footer span both columns, the medallion sits left and the rank right.
 */
export function CertificateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="certificate min-w-0 w-full break-words px-6 pb-10 pt-10 text-center md:px-14 md:pb-14 md:pt-12 lg:grid lg:grid-cols-[236px_minmax(0,1fr)] lg:items-center lg:gap-x-14 lg:px-20 lg:pb-12 lg:pt-10">
      <CornerOrnament className="cert-tl" />
      <CornerOrnament className="cert-tr" />
      <CornerOrnament className="cert-bl" />
      <CornerOrnament className="cert-br" />
      {children}
    </div>
  );
}

/** Logo and museum name at the top of the sheet. */
export function CertificateCrest() {
  return (
    <>
      <LogoMark size={44} className="mx-auto text-accent" />
      <div className="t-label mt-2 tracking-[0.2em]">Музей «Під склом»</div>
    </>
  );
}
