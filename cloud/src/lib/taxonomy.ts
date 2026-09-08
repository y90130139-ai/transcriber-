import raw from './taxonomy.json'

export type Axis = 'persona' | 'format' | 'hook'
export type Tag = { id: string; label: string; desc: string }
export type AxisSpec = { label: string; hint: string; tags: Tag[] }

export const AXES: Axis[] = ['persona', 'format', 'hook']

const spec = raw as unknown as Record<Axis, AxisSpec> & { note: string }

export const taxonomy: Record<Axis, AxisSpec> = {
  persona: spec.persona,
  format: spec.format,
  hook: spec.hook,
}

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

export function isAxis(value: string): value is Axis {
  return (AXES as string[]).includes(value)
}
