/**
 * Who the creator is, in the words the writing actually needs.
 *
 * Not a taxonomy of identity — a fact the caption engine has to have before it
 * can write a line in her voice. Kept deliberately short, and `unknown` never
 * guesses: a caption written for the wrong person is worse than one written
 * for nobody in particular.
 *
 * Its own file, with no imports, because the console's profile form needs it
 * in the browser — and `models.ts` pulls in the database driver, which
 * throws "DATABASE_URL is not set" on load there (2026-09-23: the whole
 * console showed "This page couldn't load").
 */
export const CREATOR_TYPES = ['unknown', 'woman', 'man', 'trans-woman', 'trans-man', 'non-binary', 'couple'] as const
export type CreatorType = (typeof CREATOR_TYPES)[number]

export function isCreatorType(value: unknown): value is CreatorType {
  return typeof value === 'string' && (CREATOR_TYPES as readonly string[]).includes(value)
}
