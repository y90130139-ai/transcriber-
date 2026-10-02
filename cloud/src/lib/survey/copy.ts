/**
 * Every word the creator questionnaire shows, in English and Spanish.
 *
 * The point of the form is the "why" under each choice (Geno, 2026-10-02):
 * volume, consistency, discipline and quality are what she earns from, and
 * personality converts better than text on a screen. Kept honest and kind —
 * she should finish knowing exactly what moves her up, not feeling judged.
 */
import type { Busy, Lang, PaceBand, TimeSlot } from './core'

type T = Record<Lang, string>

export const UI = {
  title: { en: 'Your creator profile', es: 'Tu perfil de creadora' },
  intro: {
    en: 'Two minutes, mostly taps. Your answers set up your plan and tell us how fast we can find the videos that work for you.',
    es: 'Dos minutos, casi todo con toques. Tus respuestas arman tu plan y nos dicen qué tan rápido podemos encontrar los videos que te funcionan.',
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
  submit: { en: 'Done', es: 'Listo' },
  sending: { en: 'Sending…', es: 'Enviando…' },
  step: { en: 'Step {n} of {total}', es: 'Paso {n} de {total}' },
  optional: { en: 'Optional', es: 'Opcional' },
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

/** The one benchmark she sees. Never her own priority (Geno, 2026-10-02). */
export const TOP_LINE: T = {
  en: 'Top creators post at least 21 reels a week on average — and they’re the ones earning the most.',
  es: 'Las creadoras top publican en promedio al menos 21 reels por semana, y son las que más ganan.',
}

/** Why volume matters, by Geno's four steps: how fast we find her winners. */
export const PACE: Record<PaceBand, { text: T; tone: 'good' | 'note' | 'warn' }> = {
  under7: {
    tone: 'warn',
    text: {
      en: 'Under 7 a week, it takes months to learn which of your videos work. Every week we’re still guessing is a week you’re not earning what you could.',
      es: 'Con menos de 7 por semana, toma meses saber cuáles de tus videos funcionan. Cada semana que seguimos adivinando es una semana sin ganar lo que podrías.',
    },
  },
  '7to13': {
    tone: 'note',
    text: {
      en: 'At 7 to 13 a week we’ll start to see patterns, but slowly. It takes a while to spot a video worth doubling down on.',
      es: 'Con 7 a 13 por semana empezamos a ver patrones, pero lento. Toma tiempo encontrar un video que valga la pena repetir.',
    },
  },
  '14to20': {
    tone: 'good',
    text: {
      en: 'At 14 to 20 a week we can spot what’s working within a few weeks and double down on it.',
      es: 'Con 14 a 20 por semana podemos ver qué funciona en pocas semanas y apostar más fuerte por eso.',
    },
  },
  '21plus': {
    tone: 'good',
    text: {
      en: 'That’s the pace top creators keep. We can test, find your winners fast and double down — the quickest way to start earning.',
      es: 'Ese es el ritmo de las creadoras top. Podemos probar, encontrar tus videos ganadores rápido y repetirlos: la forma más rápida de empezar a ganar.',
    },
  },
}

export const SPLIT = {
  title: { en: 'How we use your videos: 70 / 20 / 10', es: 'Cómo usamos tus videos: 70 / 20 / 10' },
  winners: { en: 'remakes of your proven winners', es: 'nuevas versiones de tus videos ganadores' },
  takes: { en: 'new takes on what did okay', es: 'nuevos ángulos de lo que funcionó más o menos' },
  tests: { en: 'brand-new ideas to test', es: 'ideas totalmente nuevas para probar' },
  why: {
    en: 'When a video keeps performing, we make more like it. We can only find those videos when there’s enough volume to learn from — the longer it takes to find them, the longer it takes to make money.',
    es: 'Cuando un video sigue funcionando, hacemos más como ese. Solo podemos encontrarlos si hay suficiente volumen para aprender; mientras más tardemos en encontrarlos, más tardas en ganar dinero.',
  },
}

export const IG_LINE: T = {
  en: 'Instagram is one of the best places to bring in quality subscribers. The faster we find what works for you there, the faster you earn.',
  es: 'Instagram es uno de los mejores lugares para atraer suscriptores de calidad. Mientras más rápido encontremos lo que te funciona ahí, más rápido ganas.',
}

export const RESULT = {
  done: { en: 'All done — thank you, {name}!', es: '¡Listo, gracias {name}!' },
  doneBody: {
    en: 'We’ve got your answers and we’re building your plan around them. Nothing else to do here.',
    es: 'Tenemos tus respuestas y estamos armando tu plan con ellas. No tienes que hacer nada más aquí.',
  },
  title: { en: 'Your plan', es: 'Tu plan' },
  weekly: { en: 'reels a week', es: 'reels por semana' },
  weekSplit: { en: 'Your week, split 70 / 20 / 10', es: 'Tu semana, en 70 / 20 / 10' },
  saved: { en: 'Saved to your profile. Your next plans follow these answers.', es: 'Guardado en tu perfil. Tus próximos planes siguen estas respuestas.' },
  toTop: { en: '{n} more a week puts you at top-creator pace.', es: '{n} más por semana te pone al ritmo de las creadoras top.' },
  atTop: { en: 'You’re at top-creator pace. Keep it steady — consistency is what compounds.', es: 'Estás al ritmo de las creadoras top. Mantenlo constante: la constancia es lo que se acumula.' },
}

/** Under the thank-you: marketing calls (Geno, 2026-10-02) — direction, not
 *  guessing. Booked by messaging her MARKETING topic; no new plumbing. */
export const CALLS = {
  title: { en: 'Book your marketing calls', es: 'Agenda tus llamadas de marketing' },
  lede: {
    en: 'Top creators book a marketing call every week. It’s where we go over what’s working, what isn’t, and what to film next.',
    es: 'Las creadoras top agendan una llamada de marketing cada semana. Ahí vemos qué funciona, qué no, y qué grabar después.',
  },
  whenTitle: { en: 'Book one any time', es: 'Agenda una cuando' },
  when: {
    en: ['You’re not sure what to film, or why', 'Your traffic or new subscribers feel low', 'Your videos aren’t performing like they used to'],
    es: ['No sabes qué grabar, o por qué', 'Sientes que tu tráfico o tus suscriptores nuevos están bajos', 'Tus videos no están funcionando como antes'],
  },
  why: {
    en: 'Going on “I think this is working” or doing whatever you feel like is how creators stall. Direction is how they grow: your numbers tell us what to do next, and the call is where we show you.',
    es: 'Guiarte por “creo que esto funciona” o hacer lo que se te ocurra es como las creadoras se estancan. La dirección es lo que las hace crecer: tus números nos dicen qué hacer, y en la llamada te lo mostramos.',
  },
  how: { en: 'To book, message us in your MARKETING chat on Telegram.', es: 'Para agendar, escríbenos en tu chat de MARKETING en Telegram.' },
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
