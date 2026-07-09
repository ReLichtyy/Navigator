"use client"

/**
 * bienvenida.tsx — 4-step welcome / onboarding overlay (port of Bienvenida.dc.html).
 * Shown once right after sign-up or first login (see BienvenidaGate). Left side is an
 * animated visual stage per step; right side is the copy + stepper + nav.
 */

import { useState } from "react"
import { ArrowRight, ArrowLeft } from "lucide-react"

type Step = {
  kicker: string
  title: string
  body: string
  bullets: string[] | null
}

const STEPS: Step[] = [
  {
    kicker: "Bienvenido",
    title: "Tu copiloto de estudio.",
    body: "Navigator convierte el material de tus cursos en quizzes, tarjetas y mapas mentales. Te tomará 30 segundos entender cómo funciona.",
    bullets: null,
  },
  {
    kicker: "Sube tu material",
    title: "Arrastra tus PDFs y apuntes.",
    body: "Suelta los documentos de cada curso. Navigator los lee, los indexa y construye un knowledge base propio para ese curso.",
    bullets: [
      "PDFs, diapositivas y apuntes",
      "Enlaces de video y web",
      "Indexado por curso, en segundos",
    ],
  },
  {
    kicker: "Navigator lo entiende",
    title: "Genera tu material de estudio.",
    body: "Desde tu knowledge base creamos todo lo que necesitas para repasar — dinámico y siempre basado en tus propios documentos.",
    bullets: ["Quiz y simulacros", "Tarjetas y mapas mentales", "Resúmenes automáticos"],
  },
  {
    kicker: "El Asistente",
    title: "Pregúntale a tu material.",
    body: "El asistente con IA resuelve tus dudas al instante y siempre cita la fuente dentro de tus propios documentos, para que estudies con confianza.",
    bullets: [
      "Respuestas con cita a la fuente",
      "Explica cualquier concepto",
      "Te acompaña mientras estudias",
    ],
  },
]

const KEYFRAMES = `
@keyframes obIn{from{transform:translateY(10px);opacity:0;}to{transform:translateY(0);opacity:1;}}
@keyframes obModal{0%{opacity:0;transform:translateY(20px) scale(.97);}100%{opacity:1;transform:translateY(0) scale(1);}}
@keyframes obGlow{0%,100%{opacity:.5;}50%{opacity:.9;}}
@keyframes obSpin{to{transform:rotate(360deg);}}
@keyframes obFloat{0%,100%{transform:translateY(0) rotate(var(--r,0deg));}50%{transform:translateY(-12px) rotate(var(--r,0deg));}}
@keyframes obDrop{0%{opacity:0;transform:translate(var(--dx,0),-180px) rotate(var(--dr,-12deg)) scale(.9);}55%{opacity:1;}70%{transform:translate(var(--dx,0),10px) rotate(calc(var(--rr,0deg))) scale(1.02);}100%{opacity:1;transform:translate(var(--fx,0),var(--fy,0)) rotate(var(--rr,0deg)) scale(1);}}
@keyframes obScan{0%{top:6%;opacity:0;}10%{opacity:1;}90%{opacity:1;}100%{top:94%;opacity:0;}}
@keyframes obFill{from{width:0;}to{width:100%;}}
@keyframes obRise{0%{opacity:0;transform:translateY(16px) scale(.92);}100%{opacity:1;transform:translateY(0) scale(1);}}
@keyframes obOrbit{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
@keyframes obDash{to{stroke-dashoffset:-40;}}
@keyframes obType{0%,60%,100%{transform:translateY(0);opacity:.4;}30%{transform:translateY(-4px);opacity:1;}}
`

// ── Left visual stages (verbatim from the design; mono font swapped to the app's) ──
const MONO = "var(--font-geist-mono),monospace"

const STAGE1 = `
<div style="position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">
  <div style="position:absolute;width:320px;height:320px;border:1px solid rgba(63,191,132,0.09);border-radius:50%;"></div>
  <div style="position:absolute;width:218px;height:218px;border:1px dashed rgba(63,191,132,0.22);border-radius:50%;animation:obOrbit 30s linear infinite;"></div>
  <div style="position:absolute;top:11%;left:9%;--r:-9deg;animation:obFloat 6s ease-in-out infinite;">
    <div style="width:76px;height:92px;border-radius:10px;background:linear-gradient(160deg,#1b2520,#121a16);border:1px solid rgba(255,255,255,0.10);box-shadow:0 10px 24px rgba(0,0,0,0.4);padding:10px;display:flex;flex-direction:column;justify-content:space-between;">
      <div style="width:28px;height:13px;border-radius:4px;background:#E8553A;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:800;color:#fff;font-family:${MONO};">PDF</div>
      <div style="display:flex;flex-direction:column;gap:3.5px;"><span style="height:3px;width:80%;background:rgba(255,255,255,0.18);border-radius:2px;"></span><span style="height:3px;width:60%;background:rgba(255,255,255,0.12);border-radius:2px;"></span><span style="height:3px;width:72%;background:rgba(255,255,255,0.1);border-radius:2px;"></span></div>
    </div>
  </div>
  <div style="position:absolute;top:19%;right:6%;--r:7deg;animation:obFloat 7s ease-in-out .8s infinite;">
    <div style="width:104px;border-radius:11px;background:linear-gradient(160deg,#1b2520,#121a16);border:1px solid rgba(255,255,255,0.10);box-shadow:0 10px 24px rgba(0,0,0,0.4);padding:8px;">
      <div style="position:relative;height:48px;border-radius:7px;background:linear-gradient(135deg,#2a1a1a,#1a1413);display:flex;align-items:center;justify-content:center;overflow:hidden;">
        <div style="width:24px;height:24px;border-radius:50%;background:rgba(255,90,75,0.9);display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px rgba(255,90,75,0.5);"><svg width="11" height="11" viewBox="0 0 24 24" fill="#fff"><polygon points="6 4 20 12 6 20"></polygon></svg></div>
      </div>
      <div style="margin-top:7px;display:flex;align-items:center;gap:5px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7C8983" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg><span style="font-size:8.5px;color:#9AA5A0;font-family:${MONO};">Clase 04 · 12:30</span></div>
    </div>
  </div>
  <div style="position:absolute;bottom:12%;left:17%;--r:6deg;animation:obFloat 6.5s ease-in-out .4s infinite;">
    <div style="width:74px;height:88px;border-radius:10px;background:linear-gradient(160deg,#1b2520,#121a16);border:1px solid rgba(255,255,255,0.10);box-shadow:0 10px 24px rgba(0,0,0,0.4);padding:10px;display:flex;flex-direction:column;gap:5px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>
      <div style="display:flex;flex-direction:column;gap:3.5px;margin-top:auto;"><span style="height:3px;width:90%;background:rgba(255,255,255,0.16);border-radius:2px;"></span><span style="height:3px;width:65%;background:rgba(255,255,255,0.11);border-radius:2px;"></span><span style="height:3px;width:78%;background:rgba(255,255,255,0.09);border-radius:2px;"></span></div>
    </div>
  </div>
  <div style="position:relative;z-index:3;width:108px;height:108px;border-radius:32px;background:linear-gradient(150deg,#1c2a22,#0f1611);border:1px solid rgba(63,191,132,0.4);display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 0 50px rgba(63,191,132,0.22);">
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polygon points="15.5 8.5 11 11 8.5 15.5 13 13"></polygon></svg>
    <span style="margin-top:4px;font-size:8px;font-weight:700;letter-spacing:0.16em;color:#6FCB9A;text-transform:uppercase;">Navigator</span>
  </div>
</div>`

const STAGE2 = `
<div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
  <div style="position:relative;width:230px;height:210px;">
    <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:200px;height:150px;border-radius:18px;border:2px dashed rgba(63,191,132,0.35);background:rgba(63,191,132,0.04);overflow:hidden;">
      <div style="position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#5BE39A,transparent);box-shadow:0 0 12px #5BE39A;animation:obScan 1.6s ease-in-out 1.9s 2;"></div>
    </div>
    <div style="position:absolute;left:50%;top:50%;margin-left:-43px;margin-top:-54px;--dx:-70px;--dr:-16deg;--fx:-30px;--fy:6px;--rr:-7deg;animation:obDrop 1.1s cubic-bezier(.3,1.1,.4,1) .2s both;">
      <div style="width:86px;height:104px;border-radius:11px;background:linear-gradient(160deg,#1b2520,#121a16);border:1px solid rgba(255,255,255,0.10);box-shadow:0 10px 26px rgba(0,0,0,0.4);padding:11px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="width:30px;height:14px;border-radius:4px;background:#E8553A;display:flex;align-items:center;justify-content:center;font-size:7.5px;font-weight:800;color:#fff;font-family:${MONO};">PDF</div>
        <div style="display:flex;flex-direction:column;gap:4px;"><span style="height:3px;width:80%;background:rgba(255,255,255,0.18);border-radius:2px;"></span><span style="height:3px;width:60%;background:rgba(255,255,255,0.12);border-radius:2px;"></span><span style="height:3px;width:70%;background:rgba(255,255,255,0.10);border-radius:2px;"></span></div>
      </div>
    </div>
    <div style="position:absolute;left:50%;top:50%;margin-left:-43px;margin-top:-54px;--dx:60px;--dr:14deg;--fx:30px;--fy:-4px;--rr:6deg;animation:obDrop 1.1s cubic-bezier(.3,1.1,.4,1) .75s both;">
      <div style="width:86px;height:104px;border-radius:11px;background:linear-gradient(160deg,#1b2520,#121a16);border:1px solid rgba(255,255,255,0.10);box-shadow:0 10px 26px rgba(0,0,0,0.4);padding:11px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="width:30px;height:14px;border-radius:4px;background:#E8553A;display:flex;align-items:center;justify-content:center;font-size:7.5px;font-weight:800;color:#fff;font-family:${MONO};">PDF</div>
        <div style="display:flex;flex-direction:column;gap:4px;"><span style="height:3px;width:70%;background:rgba(255,255,255,0.18);border-radius:2px;"></span><span style="height:3px;width:85%;background:rgba(255,255,255,0.12);border-radius:2px;"></span><span style="height:3px;width:55%;background:rgba(255,255,255,0.10);border-radius:2px;"></span></div>
      </div>
    </div>
    <div style="position:absolute;left:50%;top:50%;margin-left:-43px;margin-top:-54px;--dx:0px;--dr:4deg;--fx:0px;--fy:0px;--rr:0deg;animation:obDrop 1.1s cubic-bezier(.3,1.1,.4,1) 1.3s both;">
      <div style="width:86px;height:104px;border-radius:11px;background:linear-gradient(160deg,#21302a,#16201b);border:1px solid rgba(63,191,132,0.28);box-shadow:0 14px 32px rgba(0,0,0,0.5);padding:11px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="width:30px;height:14px;border-radius:4px;background:#E8553A;display:flex;align-items:center;justify-content:center;font-size:7.5px;font-weight:800;color:#fff;font-family:${MONO};">PDF</div>
        <div style="display:flex;flex-direction:column;gap:4px;"><span style="height:3px;width:78%;background:rgba(255,255,255,0.2);border-radius:2px;"></span><span style="height:3px;width:64%;background:rgba(255,255,255,0.13);border-radius:2px;"></span><span style="height:3px;width:72%;background:rgba(255,255,255,0.11);border-radius:2px;"></span></div>
      </div>
    </div>
  </div>
  <div style="width:230px;margin-top:26px;opacity:0;animation:obRise .5s ease 2s both;">
    <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#9AA5A0;margin-bottom:7px;">
      <span style="display:flex;align-items:center;gap:6px;"><span style="width:11px;height:11px;border:2px solid rgba(91,227,154,0.3);border-top-color:#5BE39A;border-radius:50%;animation:obSpin .8s linear infinite;"></span>Indexando documentos…</span>
      <span style="font-family:${MONO};color:#5BE39A;">3</span>
    </div>
    <div style="height:6px;border-radius:5px;background:rgba(255,255,255,0.07);overflow:hidden;">
      <div style="height:100%;border-radius:5px;background:linear-gradient(90deg,#3FBF84,#5BE39A);animation:obFill 1.6s ease 2.1s both;"></div>
    </div>
  </div>
  <div style="position:absolute;bottom:26px;display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:99px;background:rgba(63,191,132,0.12);border:1px solid rgba(63,191,132,0.3);opacity:0;animation:obRise .45s ease 3.7s both;">
    <span style="display:flex;width:18px;height:18px;border-radius:50%;background:#5BE39A;align-items:center;justify-content:center;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#08110B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
    <span style="font-size:12px;font-weight:700;color:#9FEDC4;">Knowledge base lista</span>
  </div>
</div>`

const TOOL_SVGS = [
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg><span style="font-size:10.5px;font-weight:700;color:#E8EDEA;white-space:nowrap;">Quiz</span>`,
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"></rect><path d="M2 12h7"></path></svg><span style="font-size:10.5px;font-weight:700;color:#E8EDEA;white-space:nowrap;">Tarjetas</span>`,
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><circle cx="5" cy="6" r="2"></circle><circle cx="19" cy="6" r="2"></circle><circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="18" r="2"></circle><path d="M10 10L6.5 7M14 10l3.5-3M10 14l-3 3.5M14.5 13.5l2.5 3"></path></svg><span style="font-size:10.5px;font-weight:700;color:#E8EDEA;white-space:nowrap;">Mapa mental</span>`,
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="14" y2="18"></line></svg><span style="font-size:10.5px;font-weight:700;color:#E8EDEA;white-space:nowrap;">Resumen</span>`,
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2 2"></path><path d="M5 3L2 6"></path><path d="M22 6l-3-3"></path></svg><span style="font-size:10.5px;font-weight:700;color:#E8EDEA;white-space:nowrap;">Simulacro</span>`,
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path></svg><span style="font-size:10.5px;font-weight:700;color:#E8EDEA;white-space:nowrap;">Repaso</span>`,
]

const TOOL_POS = [
  { top: "14px", left: "50%", tx: "-50%", ty: "0" },
  { top: "70px", right: "0", tx: "0", ty: "0" },
  { bottom: "70px", right: "0", tx: "0", ty: "0" },
  { bottom: "14px", left: "50%", tx: "-50%", ty: "0" },
  { bottom: "70px", left: "0", tx: "0", ty: "0" },
  { top: "70px", left: "0", tx: "0", ty: "0" },
]

function buildStage3(): string {
  const chips = TOOL_POS.map((p, i) => {
    const posCss = [
      p.top ? `top:${p.top};` : "",
      p.bottom ? `bottom:${p.bottom};` : "",
      p.left ? `left:${p.left};` : "",
      p.right ? `right:${p.right};` : "",
    ].join("")
    const style = `position:absolute;z-index:4;${posCss}transform:translate(${p.tx},${p.ty});display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:12px;background-color:#141b17;border:1px solid rgba(63,191,132,0.22);box-shadow:0 8px 22px rgba(0,0,0,0.35);opacity:0;animation:obRise .5s cubic-bezier(.2,.9,.3,1) ${0.25 + i * 0.13}s both;`
    return `<div style="${style}">${TOOL_SVGS[i]}</div>`
  }).join("")
  return `
<div style="position:relative;width:300px;height:300px;display:flex;align-items:center;justify-content:center;">
  <svg width="300" height="300" style="position:absolute;inset:0;pointer-events:none;overflow:visible;">
    <g stroke="#3FBF84" stroke-width="1.4" stroke-opacity="0.4" stroke-dasharray="3 5" style="animation:obDash 1s linear infinite;">
      <line x1="150" y1="150" x2="150" y2="44"></line>
      <line x1="150" y1="150" x2="252" y2="100"></line>
      <line x1="150" y1="150" x2="252" y2="208"></line>
      <line x1="150" y1="150" x2="150" y2="256"></line>
      <line x1="150" y1="150" x2="48" y2="208"></line>
      <line x1="150" y1="150" x2="48" y2="100"></line>
    </g>
  </svg>
  <div style="position:relative;z-index:3;width:88px;height:88px;border-radius:24px;background:linear-gradient(150deg,#1c2a22,#0f1611);border:1px solid rgba(63,191,132,0.4);display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 0 40px rgba(63,191,132,0.25);">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 0-4 4 4 4 0 0 0-2 7 4 4 0 0 0 6 4 4 4 0 0 0 6-4 4 4 0 0 0-2-7 4 4 0 0 0-4-4z"></path></svg>
    <span style="margin-top:5px;font-size:8.5px;font-weight:700;letter-spacing:0.1em;color:#6FCB9A;text-transform:uppercase;">Tu material</span>
  </div>
  ${chips}
</div>`
}

const STAGE4 = `
<div style="position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">
  <div style="position:absolute;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,rgba(63,191,132,0.16),transparent 65%);filter:blur(14px);animation:obGlow 6s ease-in-out infinite;"></div>
  <div style="position:relative;z-index:2;width:286px;border-radius:20px;background-color:#0d1411;border:1px solid rgba(255,255,255,0.08);box-shadow:0 22px 56px rgba(0,0,0,0.5);overflow:hidden;">
    <div style="display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="width:30px;height:30px;border-radius:9px;background:linear-gradient(150deg,#1c2a22,#0f1611);border:1px solid rgba(63,191,132,0.4);display:flex;align-items:center;justify-content:center;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7z"></path><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"></path></svg>
      </div>
      <div style="line-height:1.2;"><div style="font-size:12.5px;font-weight:700;color:#F2F6F4;">Asistente Navigator</div><div style="font-size:10px;color:#6FCB9A;display:flex;align-items:center;gap:5px;"><span style="width:5px;height:5px;border-radius:50%;background:#5BE39A;box-shadow:0 0 6px #5BE39A;"></span>conoce tu material</div></div>
    </div>
    <div style="padding:15px;display:flex;flex-direction:column;gap:10px;">
      <div style="align-self:flex-end;max-width:82%;padding:9px 13px;border-radius:14px 14px 4px 14px;background:rgba(63,191,132,0.14);border:1px solid rgba(63,191,132,0.22);font-size:11.5px;line-height:1.45;color:#DCEFE5;opacity:0;animation:obRise .4s ease .2s both;">¿Qué temas entran en el parcial del martes?</div>
      <div style="align-self:flex-start;max-width:90%;padding:11px 13px;border-radius:14px 14px 14px 4px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);opacity:0;animation:obRise .4s ease 1.2s both;">
        <div style="display:flex;flex-direction:column;gap:5px;"><span style="height:5px;width:100%;background:rgba(255,255,255,0.18);border-radius:3px;"></span><span style="height:5px;width:84%;background:rgba(255,255,255,0.13);border-radius:3px;"></span><span style="height:5px;width:62%;background:rgba(255,255,255,0.1);border-radius:3px;"></span></div>
        <div style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:8px;background:rgba(63,191,132,0.1);border:1px solid rgba(63,191,132,0.22);">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5BE39A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
          <span style="font-size:9.5px;font-weight:600;color:#9FEDC4;font-family:${MONO};">Programa_curso.pdf · p.2</span>
        </div>
      </div>
      <div style="align-self:flex-start;display:flex;gap:4px;padding:10px 13px;border-radius:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);opacity:0;animation:obRise .3s ease 2.2s both;">
        <span style="width:6px;height:6px;border-radius:50%;background:#5BE39A;animation:obType 1.1s infinite 2.3s;"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#5BE39A;animation:obType 1.1s infinite 2.45s;"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#5BE39A;animation:obType 1.1s infinite 2.6s;"></span>
      </div>
    </div>
  </div>
</div>`

function stageHtml(step: number): string {
  if (step === 0) return STAGE1
  if (step === 1) return STAGE2
  if (step === 2) return buildStage3()
  return STAGE4
}

export function Bienvenida({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0)
  const cfg = STEPS[step]

  const next = () => (step >= 3 ? onFinish() : setStep(step + 1))
  const back = () => setStep(Math.max(0, step - 1))
  const goTo = (i: number) => setStep(i)

  const nextLabel =
    step === 3 ? "Empezar a estudiar" : step === 0 ? "Ver cómo funciona" : "Continuar"

  return (
    <div
      style={{ fontFamily: "var(--font-geist),system-ui,sans-serif" }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8"
    >
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1100px 700px at 50% -5%,rgba(63,191,132,0.07),transparent 60%),#060807",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.03) 1px,transparent 1px)",
          backgroundSize: "26px 26px",
          opacity: 0.6,
        }}
      />

      {/* modal — capped + scrollable so short/landscape viewports never clip the
          footer nav (no fixed height below md, where the visual stage is hidden). */}
      <div
        className="relative z-[2] flex w-full max-w-[940px] max-h-[calc(100dvh-2rem)] flex-col overflow-y-auto rounded-[26px] md:h-[580px] md:max-h-[calc(100dvh-2rem)] md:flex-row md:overflow-hidden"
        style={{
          background: "#0B0F0D",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 40px 120px rgba(0,0,0,0.6),0 0 0 1px rgba(63,191,132,0.05)",
          animation: "obModal .5s cubic-bezier(.2,.8,.2,1) both",
        }}
      >
        {/* LEFT: visual stage (hidden on mobile to keep modal compact) */}
        <div
          className="relative hidden w-[48%] flex-none overflow-hidden md:block"
          style={{
            background: "linear-gradient(165deg,#0e1712 0%,#0a0f0c 100%)",
            borderRight: "1px solid rgba(63,191,132,0.10)",
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: "radial-gradient(rgba(63,191,132,0.05) 1px,transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />
          <div
            className="absolute"
            style={{
              top: "-90px",
              left: "-60px",
              width: "300px",
              height: "300px",
              borderRadius: "50%",
              background: "radial-gradient(circle,rgba(63,191,132,0.20),transparent 65%)",
              filter: "blur(18px)",
              animation: "obGlow 7s ease-in-out infinite",
            }}
          />
          <div
            key={`stage-${step}`}
            className="relative z-[2] flex h-full w-full items-center justify-center"
            dangerouslySetInnerHTML={{ __html: stageHtml(step) }}
          />
        </div>

        {/* RIGHT: copy */}
        <div
          className="relative flex min-w-0 flex-1 flex-col p-7 sm:p-10"
          style={{ background: "#0B0F0D" }}
        >
          {/* top row: brand + skip */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-[26px] w-[26px] items-center justify-center rounded-[8px]"
                style={{
                  background: "linear-gradient(150deg,#1c2a22,#0f1611)",
                  border: "1px solid rgba(63,191,132,0.4)",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#5BE39A"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9"></circle>
                  <polygon points="15.5 8.5 11 11 8.5 15.5 13 13"></polygon>
                </svg>
              </div>
              <span className="text-[13.5px] font-extrabold tracking-tight text-[#F2F6F4]">
                Navigator
              </span>
            </div>
            <button
              onClick={onFinish}
              className="cursor-pointer p-1.5 text-[12.5px] font-semibold text-[#5C6661] transition-colors hover:text-[#9AA5A0]"
            >
              Saltar intro
            </button>
          </div>

          {/* step copy */}
          <div className="flex max-w-[330px] flex-1 flex-col justify-center py-8 md:py-0">
            <div key={`step-${step}`} style={{ animation: "obIn .4s ease both" }}>
              <div
                className="mb-[18px] inline-flex items-center gap-[7px] rounded-full px-3 py-[5px]"
                style={{
                  background: "rgba(63,191,132,0.10)",
                  border: "1px solid rgba(63,191,132,0.2)",
                }}
              >
                <span
                  className="text-[10.5px] font-semibold text-[#5BE39A]"
                  style={{ fontFamily: MONO }}
                >
                  PASO {step + 1}/4
                </span>
                <span className="h-1 w-1 rounded-full bg-[#3a463f]" />
                <span className="text-[11px] font-semibold text-[#9FEDC4]">{cfg.kicker}</span>
              </div>
              <h2 className="m-0 text-[28px] font-extrabold leading-[1.15] tracking-[-0.03em] text-[#F4F8F6] text-balance">
                {cfg.title}
              </h2>
              <p className="mt-3.5 text-[14.5px] leading-relaxed text-[#9AA5A0]">{cfg.body}</p>

              {cfg.bullets && (
                <div className="mt-[18px] flex flex-col gap-2.5">
                  {cfg.bullets.map((bl) => (
                    <div key={bl} className="flex items-center gap-2.5">
                      <span
                        className="flex h-5 w-5 flex-none items-center justify-center rounded-[6px]"
                        style={{
                          background: "rgba(63,191,132,0.12)",
                          border: "1px solid rgba(63,191,132,0.25)",
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#5BE39A"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </span>
                      <span className="text-[13.5px] text-[#C9D2CD]">{bl}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* footer: dots + nav */}
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              {[0, 1, 2, 3].map((i) => {
                const done = i < step
                const current = i === step
                const circleStyle: React.CSSProperties = current
                  ? {
                      background: "linear-gradient(160deg,#5BE39A,#3FBF84)",
                      color: "#08110B",
                      boxShadow: "0 0 0 4px rgba(63,191,132,0.13)",
                    }
                  : done
                    ? {
                        background: "rgba(63,191,132,0.14)",
                        color: "#7CE0AC",
                        border: "1px solid rgba(63,191,132,0.4)",
                      }
                    : {
                        background: "rgba(255,255,255,0.03)",
                        color: "#5C6661",
                        border: "1px solid rgba(255,255,255,0.1)",
                      }
                return (
                  <div key={i} className="flex items-center">
                    <span
                      onClick={() => goTo(i)}
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-[11px] font-bold transition-all"
                      style={{ fontFamily: MONO, ...circleStyle }}
                    >
                      {i + 1}
                    </span>
                    {i < 3 && (
                      <span
                        className="mx-[3px] h-0.5 w-4 rounded-[2px]"
                        style={{ background: i < step ? "#3FBF84" : "rgba(255,255,255,0.12)" }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-2.5">
              {step > 0 && (
                <button
                  onClick={back}
                  className="flex h-[46px] items-center gap-1.5 rounded-[13px] px-[18px] text-[14px] font-semibold text-[#C9D2CD] transition-colors hover:bg-white/[0.04]"
                  style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
                  <span className="hidden sm:inline">Atrás</span>
                </button>
              )}
              <button
                onClick={next}
                className="flex h-[46px] cursor-pointer items-center gap-2.5 rounded-[13px] px-6 text-[14.5px] font-bold tracking-tight text-[#08110B] transition-all hover:-translate-y-px"
                style={{
                  background: "linear-gradient(180deg,#5BE39A,#3FBF84)",
                  boxShadow: "0 8px 24px rgba(63,191,132,0.22)",
                }}
              >
                <span>{nextLabel}</span>
                <ArrowRight className="h-[17px] w-[17px]" strokeWidth={2.3} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
