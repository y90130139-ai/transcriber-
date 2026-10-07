import raw from './taxonomy.json'

export type Axis = 'persona' | 'format' | 'hook' | 'topic'
export type Tag = { id: string; label: string; desc: string }
export type AxisSpec = { label: string; hint: string; tags: Tag[] }

export const AXES: Axis[] = ['persona', 'format', 'hook', 'topic']

const spec = raw as unknown as Record<Axis, AxisSpec> & { note: string }

export const taxonomy: Record<Axis, AxisSpec> = {
  persona: spec.persona,
  format: spec.format,
  hook: spec.hook,
  topic: spec.topic,
}

/** The topic that is not a subject: any model can be handed one of these, with
 *  the structure kept and the subject swapped for her own world. */
export const RELATABLE = 'relatable'

/** Nothing said what it was about. Never matched on, never guessed at. */
export const UNKNOWN_TOPIC = 'unknown'

const index = new Map<string, Tag>(
  AXES.flatMap((axis) => taxonomy[axis].tags.map((tag) => [`${axis}:${tag.id}`, tag])),
)

/** The human label for a tag id, falling back to the id so nothing renders blank. */
export function labelOf(axis: Axis, id: string): string {
  return index.get(`${axis}:${id}`)?.label ?? id
}

export function isValidTag(axis: Axis, id: string): boolean {
  return index.has(`${axis}:${id}`)
}

/** A stable colour per tag — its place in the axis, cycled through the eight
 *  tones the stylesheets define. A wall of tags then reads as categories
 *  rather than one accent repeated. */
export function toneOf(axis: Axis, id: string): number {
  const at = taxonomy[axis].tags.findIndex((tag) => tag.id === id)
  return at < 0 ? 8 : (at % 8) + 1
}

export function isAxis(value: string): value is Axis {
  return (AXES as string[]).includes(value)
}
