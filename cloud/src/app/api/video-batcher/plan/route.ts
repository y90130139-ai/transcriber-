import { NextResponse } from 'next/server'
import { isSignedIn } from '@/lib/auth'
import { aiReady, askJson } from '@/lib/ai'
import { validateAiSuggestion, type AiBatcherSuggestion } from '@/lib/video-batcher'

interface MediaSummary {
  kind: 'video' | 'image'
  width: number
  height: number
  duration: number | null
}

function cleanMediaSummary(value: unknown): MediaSummary[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 10).flatMap((entry): MediaSummary[] => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Record<string, unknown>
    if (candidate.kind !== 'video' && candidate.kind !== 'image') return []
    const width = Number(candidate.width)
    const height = Number(candidate.height)
    const duration = candidate.duration === null ? null : Number(candidate.duration)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return []
    return [{
      kind: candidate.kind,
      width: Math.round(width),
      height: Math.round(height),
      duration: duration !== null && Number.isFinite(duration) && duration >= 0 ? Math.min(duration, 86_400) : null,
    }]
  })
}

export async function POST(request: Request) {
  if (!(await isSignedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) return NextResponse.json({ error: 'Add an instruction first.' }, { status: 400 })
  if (prompt.length > 1200) return NextResponse.json({ error: 'Keep the instruction under 1200 characters.' }, { status: 400 })
  if (!aiReady()) return NextResponse.json({ error: 'The existing AI provider is not configured for this deployment.' }, { status: 503 })

  const media = cleanMediaSummary(body?.mediaSummary)
  const instruction = [
    'Translate the creator’s instruction into a conservative Video Batcher configuration.',
    'Return one JSON object only, with optional keys: variations (integer 1..100), videoFormat (auto|webm|mp4), aspectRatio (original|portrait|landscape|square), resolution (original|1080p|720p), effects.',
    'effects may contain only brightness, contrast, saturation, hue, zoom, rotation, shiftX, shiftY, speed, trimStart, trimEnd. Each effect is {"enabled":boolean,"min":number,"max":number}.',
    'Use only effect units and bounds: brightness -50..50, contrast -50..100, saturation -100..100, hue -180..180, zoom 1..2, rotation -45..45, shiftX/shiftY -25..25, speed .25..4, trimStart/trimEnd 0..600.',
    'Keep ranges subtle unless requested. Do not fabricate metadata, claim GPU acceleration, or start processing. Leave unspecified settings out.',
    `Instruction: ${prompt}`,
    `Media summary (no filenames or media bytes): ${JSON.stringify(media)}`,
  ].join('\n')

  try {
    const answer = await askJson<unknown>(instruction, { maxTokens: 700, temperature: 0.2 })
    const suggestion = validateAiSuggestion(answer) as AiBatcherSuggestion | null
    if (!suggestion) return NextResponse.json({ error: 'The AI response did not match a supported configuration. Try a more specific instruction.' }, { status: 502 })
    return NextResponse.json({ suggestion })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The AI service could not make a suggestion.' }, { status: 502 })
  }
}
