'use client'

import { displayHandle, labelOfPlatform, shortOfPlatform, withImpliedInstagram, withLinkedOnlyfans } from '@/lib/socials'
import PlatformIcon, { hasPlatformIcon } from '../PlatformIcon'
import type { Social } from '@/lib/socials'
import type { ProfileForm } from './form'
import { HEAT_MARK } from '@/lib/engagement'
import type { Standing } from '@/lib/standing'
import { StandingControls } from './StandingTab'
import TrendChip from '../TrendChip'
import ActiveControl, { type ActiveState } from './ActiveControl'

/** Opening more than this at once is how a browser decides you are a popup ad,
 *  and how an operator decides they have lost their tabs. */
const OPEN_ALL_CAP = 6

/**
 * The top of the sheet: who she is, and every account of hers as a button.
 *
 * The buttons are the reason this screen exists. Reviewing someone's content
 * used to mean remembering the handle and typing it into a search box, which is
 * why it did not happen often enough — so every account is one tap from here,
 * and from the roster card too.
 */
export default function ProfileHead({
  standing,
  form,
  isNew,
  busy,
  onPhoto,
  onClose,
  onAddLinks,
  modelId = null,
  onStanding,
  linkedOnlyfans,
  active,
  onActive,
}: {
  standing?: Standing
  form: ProfileForm
  isNew: boolean
  busy: boolean
  onPhoto: (file: File | undefined) => void
  onClose: () => void
  /** Takes you to the tab where accounts are added — the empty state has to
   *  lead somewhere, or it is just a sentence saying no. */
  onAddLinks: () => void
  /** Set for a saved model: priority and revenue become editable here. */
  modelId?: string | null
  onStanding?: () => void
  /** Her OnlyFans usernames from matched Infloww accounts, shown as buttons. */
  linkedOnlyfans?: string[]
  /** Her active state, for Deactivate / Reactivate. Absent for a new model. */
  active?: ActiveState
  onActive?: (next: ActiveState) => void
}) {
  // The handle every model already has is rendered as an Instagram button
  // whether or not anyone has filled in the accounts list. Merged for display
  // only; nothing is written to the column. See `withImpliedInstagram`.
  // Her OnlyFans pages come from the Infloww accounts matched to her, also
  // display-only (`withLinkedOnlyfans`), so they follow a re-match by themselves.
  const links = withLinkedOnlyfans(withImpliedInstagram(form.socials, form.handle || null), linkedOnlyfans)

  function openAll() {
    for (const link of links.slice(0, OPEN_ALL_CAP)) {
      window.open(link.url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <>
      {/* Its own sticky strip rather than a corner of the cover. As a grid
          child of the cover it stretched to the full column, and as a floated
          one it could not stay put once the cover scrolled away — which on a
          phone leaves the sheet with no way out at all. */}
      <div className="sheet-topbar">
        <button className="sheet-close" onClick={onClose} aria-label="Close">Close</button>
      </div>

      <div className="sheet-cover">
        <span className="sheet-kicker">
          {isNew ? 'One of ours' : 'Ours — not a researched account'}
        </span>
        <h2>{form.name.trim() || 'New model'}</h2>
      </div>

      <div className="sheet-id">
        <div className="sheet-avatar-wrap">
        <label className="sheet-avatar" aria-label={form.photo_url ? 'Replace their photo' : 'Add a photo'}>
          {form.photo_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={form.photo_url} alt="" width={264} height={264} />
          ) : (
            <span className="sheet-avatar-empty">{form.name.trim() || 'No photo'}</span>
          )}
          <span className="sheet-avatar-swap">{form.photo_url ? 'Replace' : 'Add'}</span>
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={busy}
            onChange={(event) => onPhoto(event.target.files?.[0])}
          />
        </label>
        {/* Outside the circle, which clips anything inside it. */}
        <TrendChip trend={standing?.trend} />
        </div>

        <div className="sheet-names">
          <span>{form.handle ? `@${form.handle}` : 'No handle yet'}</span>
          <span className="sheet-flags">
            {standing && HEAT_MARK[standing.engagement.heat] && (
              <span title={standing.engagement.why}>
                {HEAT_MARK[standing.engagement.heat]} {standing.engagement.heat === 'fire' ? 'On fire' : 'Cold'}
              </span>
            )}
            <span>{form.tier} · {TIER_WORD[form.tier]}</span>
            {form.status === 'paused' && <span data-tone="paused">Inactive</span>}
            {form.ig_account_type === 'professional' && <span>Professional</span>}
            {form.ig_account_type === 'personal' && <span data-tone="paused">Personal IG</span>}
            {form.ig_account_type === 'unknown' && <span data-tone="quiet">IG not checked</span>}
            {form.photo_url === null && <span data-tone="quiet">No photo</span>}
          </span>
          {modelId && <StandingControls modelId={modelId} onChanged={onStanding} />}
          {modelId && active && onActive && (
            <ActiveControl modelId={modelId} name={form.name || 'she'} state={active} onChange={onActive} />
          )}
        </div>
      </div>

      <div className="sheet-links">
        {links.length === 0 ? (
          <>
            <span className="sheet-links-empty">No accounts on file.</span>
            <button className="sheet-link" onClick={onAddLinks}>
              <b>+</b><span>Add one</span>
            </button>
          </>
        ) : (
          <>
            {links.map((link) => (
              <LinkButton key={link.url} link={link} />
            ))}
            {links.length > 1 && (
              <button
                className="sheet-link"
                data-all="true"
                onClick={openAll}
                title={
                  links.length > OPEN_ALL_CAP
                    ? `Opens the first ${OPEN_ALL_CAP}`
                    : 'Opens every account in its own tab'
                }
              >
                <b>↗</b>
                <span>Open all {links.length > OPEN_ALL_CAP ? `${OPEN_ALL_CAP}` : links.length}</span>
              </button>
            )}
          </>
        )}
      </div>
    </>
  )
}

const TIER_WORD: Record<'A' | 'B' | 'C', string> = {
  A: 'bespoke',
  B: 'mixed',
  C: 'library only',
}

/** `rel="noreferrer"` alongside `noopener` on purpose: these open a creator's
 *  own page and there is no reason to hand it this console's address. */
function LinkButton({ link }: { link: Social }) {
  return (
    <a
      className="sheet-link"
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <b title={labelOfPlatform(link.platform)} data-icon={hasPlatformIcon(link.platform) || undefined}>
        {hasPlatformIcon(link.platform)
          ? <PlatformIcon platform={link.platform} size={16} />
          : shortOfPlatform(link.platform)}
      </b>
      <span>{displayHandle(link)}</span>
    </a>
  )
}
