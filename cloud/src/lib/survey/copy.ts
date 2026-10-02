/**
 * Every word the creator questionnaire shows, in English and Spanish.
 *
 * The point of the form is the "why" under each choice (Geno, 2026-10-02):
 * volume, consistency, discipline and quality are what she earns from, and
 * personality converts better than text on a screen. Kept honest and kind —
 * she should finish knowing exactly what moves her up, not feeling judged.
 */
import type { Busy, Lang, NextStep, Priority, TimeSlot } from './core'

type T = Record<Lang, string>

export const UI = {
  title: { en: 'Your creator profile', es: 'Tu perfil de creadora' },
  intro: {
    en: 'Two minutes, mostly taps. Your answers set up your plan and your priority — who gets first pick of the best new videos each week.',
    es: 'Dos minutos, casi todo con toques. Tus respuestas arman tu plan y tu prioridad: quién elige primero los mejores videos nuevos cada semana.',
  },
  truthsTitle: { en: 'How this works', es: 'Cómo funciona' },
  truths: {
    en: [
      'The more you make, the more chances you have to earn.',
      'The more consistent you are, the more you earn.',
      'The more disciplined you stay, the more you earn.',
      'The better the quality, the more you earn.',
      'The less you make, the less you earn.',
    ],
    es: [
      'Mientras más creas, más oportunidades tienes de ganar.',
      'Mientras más constante seas, más ganas.',
      'Mientras más disciplina mantengas, más ganas.',
      'Mientras mejor la calidad, más ganas.',
      'Mientras menos creas, menos ganas.',
    ],
  },
  start: { en: 'Start', es: 'Empezar' },
  next: { en: 'Next', es: 'Siguiente' },
  back: { en: 'Back', es: 'Atrás' },
  submit: { en: 'Send my answers', es: 'Enviar mis respuestas' },
  sending: { en: 'Sending…', es: 'Enviando…' },
  step: { en: 'Step {n} of {total}', es: 'Paso {n} de {total}' },
  optional: { en: 'Optional', es: 'Opcional' },
  retake: { en: 'Change my answers', es: 'Cambiar mis respuestas' },
  openPlan: { en: 'Open my plan', es: 'Abrir mi plan' },
  sendFailed: { en: 'That did not go through. Check your connection and try again.', es: 'No se envió. Revisa tu conexión e inténtalo otra vez.' },
}

export const Q = {
  perDay: {
    title: { en: 'On a filming day, how many reels can you make?', es: 'En un día de grabación, ¿cuántos reels puedes hacer?' },
  },
  days: {
    title: { en: 'Which days can you film?', es: '¿Qué días puedes grabar?' },
    hint: { en: 'Tap every day that usually works.', es: 'Toca todos los días que normalmente te funcionan.' },
  },
  times: {
    title: { en: 'When are you at your best to film?', es: '¿A qué hora estás en tu mejor momento para grabar?' },
    why: {
      en: 'We plan around the hours you have good light, energy and time for two or three takes.',
      es: 'Planeamos según las horas en que tienes buena luz, energía y tiempo para dos o tres tomas.',
    },
  },
  weekly: {
    title: { en: 'So how many reels a week can you commit to?', es: 'Entonces, ¿cuántos reels por semana puedes comprometerte a hacer?' },
    hint: { en: 'We filled this in from your answers. Change it if real life says otherwise.', es: 'Lo llenamos con tus respuestas. Cámbialo si tu realidad es otra.' },
  },
  formats: {
    title: { en: 'Which kinds of video are you comfortable making?', es: '¿Qué tipos de video te sientes cómoda haciendo?' },
    hint: { en: 'Pick as many as you like.', es: 'Elige todos los que quieras.' },
  },
  wont: {
    title: { en: 'Anything you won’t do?', es: '¿Algo que no harías?' },
    hint: { en: 'We will never send you these.', es: 'Nunca te enviaremos estos.' },
  },
  personas: {
    title: { en: 'Which sound like you?', es: '¿Cuáles suenan a ti?' },
    hint: { en: 'Pick up to 3.', es: 'Elige hasta 3.' },
    why: {
      en: 'Your niche is your promise. Pick it and stay with it — the same vibe every week is how people know what they follow you for. Switching it up confuses both the algorithm and your audience.',
      es: 'Tu nicho es tu promesa. Elígelo y mantente en él: la misma vibra cada semana es cómo la gente sabe por qué te sigue. Cambiar todo el tiempo confunde al algoritmo y a tu audiencia.',
    },
  },
  busy: {
    title: { en: 'A busy week comes up. What usually happens?', es: 'Llega una semana ocupada. ¿Qué suele pasar?' },
  },
}

export function perDayWhy(n: number): T {
  if (n <= 1) return {
    en: 'One a day is a start. Seven a week gives Instagram a reason to keep showing you — and every extra video is another chance to take off.',
    es: 'Uno al día es un comienzo. Siete por semana le dan a Instagram una razón para seguir mostrándote, y cada video extra es otra oportunidad de despegar.',
  }
  if (n === 2) return {
    en: 'Two a day is where accounts start to move. More videos means more chances one of them takes off.',
    es: 'Dos al día es donde las cuentas empiezan a moverse. Más videos, más oportunidades de que uno despegue.',
  }
  if (n === 3) return {
    en: 'Three a day is the pace our top earners keep. Volume is the single biggest lever you control.',
    es: 'Tres al día es el ritmo de nuestras creadoras que más ganan. El volumen es la palanca más grande que controlas.',
  }
  return {
    en: 'That’s top-tier volume. Keep the quality up and this is how you outgrow everyone else.',
    es: 'Eso es volumen de primer nivel. Mantén la calidad y así es como superas a todas.',
  }
}

export function daysWhy(count: number): T {
  if (count <= 2) return {
    en: 'Fewer days means bigger gaps, and gaps cost reach. Instagram rewards accounts that show up often.',
    es: 'Menos días significa más huecos, y los huecos cuestan alcance. Instagram premia a las cuentas que aparecen seguido.',
  }
  if (count <= 4) return {
    en: 'Solid. Keep these the same days every week so filming becomes a habit, not a decision.',
    es: 'Bien. Mantén los mismos días cada semana para que grabar sea un hábito, no una decisión.',
  }
  return {
    en: 'Showing up most days is what consistency looks like — and consistency is what compounds.',
    es: 'Aparecer casi todos los días es lo que se ve como constancia, y la constancia es lo que se acumula.',
  }
}

export const DAY_LABELS: Record<Lang, string[]> = {
  // 0 = Sunday, matching models.filming_days.
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
}
/** Shown Monday first; values stay 0 = Sunday. */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export const TIME_LABELS: Record<TimeSlot, { label: T; span: T }> = {
  morning: { label: { en: 'Morning', es: 'Mañana' }, span: { en: '6–11am', es: '6–11am' } },
  midday: { label: { en: 'Midday', es: 'Mediodía' }, span: { en: '11am–2pm', es: '11am–2pm' } },
  afternoon: { label: { en: 'Afternoon', es: 'Tarde' }, span: { en: '2–6pm', es: '2–6pm' } },
  evening: { label: { en: 'Evening', es: 'Noche' }, span: { en: '6–10pm', es: '6–10pm' } },
  late: { label: { en: 'Late night', es: 'Muy tarde' }, span: { en: 'after 10pm', es: 'después de las 10pm' } },
}

export const GROUPS = {
  onCamera: {
    title: { en: 'Shows your personality', es: 'Muestra tu personalidad' },
    why: {
      en: 'Talking, storytimes, skits. These convert best — people follow and pay for a person, not a caption.',
      es: 'Hablar a cámara, historias, sketches. Estos convierten mejor: la gente sigue y paga por una persona, no por un texto.',
    },
  },
  batch: {
    title: { en: 'Quick to batch', es: 'Rápidos de hacer en lote' },
    why: {
      en: 'Text overlays, thirst traps, lip syncs. Easy to make in bulk, but they turn far fewer viewers into fans.',
      es: 'Textos en pantalla, thirst traps, lip syncs. Fáciles de hacer en cantidad, pero convierten a muchos menos espectadores en fans.',
    },
  },
  other: { title: { en: 'More', es: 'Más' } },
}

export function formatsVerdict(onCamera: number, batch: number): { tone: 'good' | 'warn'; text: T } | null {
  if (onCamera === 0 && batch === 0) return null
  if (onCamera === 0) return {
    tone: 'warn',
    text: {
      en: 'Honest heads-up: creators who only make quick-to-batch videos find it much harder to grow their income, however good they look. People pay for a personality they feel they know. Add even one on-camera format and you move up a step.',
      es: 'Te lo decimos con honestidad: a las creadoras que solo hacen videos rápidos en lote les cuesta mucho más subir sus ingresos, por muy bien que se vean. La gente paga por una personalidad que siente que conoce. Agrega aunque sea un formato a cámara y subes un nivel.',
    },
  }
  if (batch === 0) return {
    tone: 'good',
    text: {
      en: 'This is the content that converts best. Keep the volume up and you’ll feel it.',
      es: 'Este es el contenido que mejor convierte. Mantén el volumen y lo vas a notar.',
    },
  }
  return {
    tone: 'good',
    text: {
      en: 'Good mix: batch videos keep your volume up, on-camera ones turn viewers into fans.',
      es: 'Buena mezcla: los videos en lote mantienen tu volumen, los de cámara convierten espectadores en fans.',
    },
  }
}

export const BUSY_OPTIONS: Record<Busy, { label: T; why: T; tone: 'good' | 'warn' }> = {
  ahead: {
    label: { en: 'I film ahead so I don’t miss', es: 'Grabo por adelantado para no fallar' },
    why: {
      en: 'That’s discipline — the thing that separates creators who grow from creators who stall.',
      es: 'Eso es disciplina: lo que separa a las creadoras que crecen de las que se estancan.',
    },
    tone: 'good',
  },
  catchup: {
    label: { en: 'I catch up later', es: 'Me pongo al día después' },
    why: {
      en: 'Catching up works, but posting in bursts gets less reach than a steady rhythm. Try filming one day ahead.',
      es: 'Ponerse al día funciona, pero publicar a ráfagas tiene menos alcance que un ritmo constante. Intenta grabar un día por adelantado.',
    },
    tone: 'warn',
  },
  skip: {
    label: { en: 'I usually skip that week', es: 'Normalmente me salto esa semana' },
    why: {
      en: 'Thanks for being honest. A skipped week resets your momentum — the algorithm and your fans both notice. Even two or three quick videos keep you in the game.',
      es: 'Gracias por tu honestidad. Una semana sin publicar reinicia tu impulso: el algoritmo y tus fans lo notan. Aunque sean dos o tres videos rápidos, sigues en el juego.',
    },
    tone: 'warn',
  },
}

export const PRIORITY_COPY: Record<Priority, T> = {
  S: { en: 'First pick of the best new videos, every week.', es: 'Primera en elegir los mejores videos nuevos, cada semana.' },
  A: { en: 'Early pick of the best new videos.', es: 'Eliges temprano entre los mejores videos nuevos.' },
  B: { en: 'You pick after the top creators.', es: 'Eliges después de las creadoras top.' },
  C: { en: 'You pick from what’s left after everyone else.', es: 'Eliges de lo que queda después de las demás.' },
}

export const RESULT = {
  title: { en: 'You start at priority', es: 'Empiezas en prioridad' },
  weekly: { en: '{n} reels a week', es: '{n} reels por semana' },
  saved: { en: 'Saved to your profile. Your next plans follow these answers.', es: 'Guardado en tu perfil. Tus próximos planes siguen estas respuestas.' },
  liveTier: { en: 'At {n} a week you start at {p}.', es: 'Con {n} por semana empiezas en {p}.' },
}

export function nextStepText(step: NextStep): T {
  if (step.kind === 'top') return {
    en: 'You’re at the top. Stay consistent to keep it — priority follows what you actually post.',
    es: 'Estás en lo más alto. Mantén la constancia para quedarte ahí: la prioridad sigue lo que publicas de verdad.',
  }
  if (step.kind === 'on-camera') return {
    en: `Add one on-camera format — talking, a storytime, a skit — and you move up to ${step.to}.`,
    es: `Agrega un formato a cámara (hablar, una historia, un sketch) y subes a ${step.to}.`,
  }
  return {
    en: `${step.more} more reel${step.more === 1 ? '' : 's'} a week moves you up to ${step.to}.`,
    es: `${step.more} reel${step.more === 1 ? '' : 's'} más por semana te sube a ${step.to}.`,
  }
}

/** Spanish names for the taxonomy (English comes from taxonomy.json). */
export const ES_LABELS: Record<string, string> = {
  // formats
  'thirst-trap': 'Thirst trap', grwm: 'Arréglate conmigo (GRWM)', storytime: 'Storytime / historia', 'q-and-a': 'Preguntas y respuestas',
  'day-in-life': 'Un día conmigo', 'fit-check': 'Outfit del día', 'try-on': 'Probándome ropa', gym: 'Gym / ejercicio',
  'pov-skit': 'POV / sketch de rol', comedy: 'Sketch de comedia', reaction: 'Reacción / dúo', 'lip-sync': 'Lip sync / tendencia',
  bts: 'Detrás de cámaras', promo: 'Promo / llamado a la acción', advice: 'Consejos / tutorial', rant: 'Opinión / desahogo',
  collab: 'Colaboración', teaser: 'Adelanto', 'talking-head': 'Hablando a cámara', skit: 'Sketch', 'text-overlay': 'Texto en pantalla',
  'street-interview': 'Entrevista en la calle', 'rage-bait': 'Polémica (rage bait)', 'snap-banner': 'Banner de Snapchat', dance: 'Baile',
  mirror: 'Espejo', reveal: 'Revelación', confession: 'Confesión', 'car-confession': 'Confesión en el carro',
  // personas
  faceless: 'Sin mostrar la cara', 'girl-next-door': 'Chica de al lado', latina: 'Latina', 'alt-goth': 'Alternativa / gótica',
  'e-girl': 'E-girl', fitness: 'Fitness', 'cosplay-gaming': 'Cosplay / gaming', 'milf-mature': 'MILF / madura', pregnant: 'Embarazada',
  postpartum: 'Posparto / mamá reciente', lactation: 'Lactancia', petite: 'Petite', 'curvy-bbw': 'Curvy / BBW', 'big-boobs': 'Busto grande',
  'big-booty': 'Pompis grande', 'bimbo-hyperfem': 'Bimbo / hiperfemenina', tomboy: 'Tomboy', domme: 'Domme / dominante',
  'brat-sub': 'Brat / sumisa', findom: 'Findom', gfe: 'Experiencia de novia (GFE)', 'toxic-gf': 'Novia tóxica',
  amateur: 'Amateur / casera', 'luxury-glam': 'Lujo / glam', 'soft-cottagecore': 'Suave / cottagecore', inked: 'Tatuada / con piercings',
  'sports-cheer': 'Deportes / porrista', 'uniform-roleplay': 'Uniformes / rol', feet: 'Pies', asmr: 'ASMR', couples: 'Parejas', trans: 'Trans',
}

export const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), text)
