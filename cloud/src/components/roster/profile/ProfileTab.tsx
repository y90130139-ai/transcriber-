'use client'

import IntakeDrop, { type IntakePick } from '../IntakeDrop'
import type { HerPost } from '../types'
import FollowerLog from './FollowerLog'
import SocialEditor from './SocialEditor'
import TopPosts from './TopPosts'
import type { ProfileForm, SetField } from './form'
import type { Reading } from './reach'

const IG_CHOICES = [
  ['unknown', 'Not checked'],
  ['professional', 'Professional'],
  ['personal', 'Personal'],
] as const

const IG_HINT: Record<ProfileForm['ig_account_type'], string> = {
  professional: 'Her numbers are readable once the app is approved — views, saves, watch time.',
  personal: 'Switch her to a Creator account, or we never see how her posts did.',
  unknown: 'Ask her, or look: a professional account shows a category under the handle.',
}

/** Who she is and where she is — the half of the sheet you open to review her
 *  rather than to plan her week. */
export default function ProfileTab({
  form,
  set,
  modelId,
  readings,
  posts,
  onIntake,
  onRecorded,
}: {
  form: ProfileForm
  set: SetField
  modelId: string | null
  readings: Reading[]
  posts: HerPost[]
  onIntake: (picked: IntakePick) => void
  onRecorded: () => void
}) {
  return (
    <>
      <div className="form-pair">
        <div className="form-row">
          <label className="axis-name" htmlFor="model-name">Name</label>
          <input
            id="model-name"
            className="field"
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder="What she goes by"
          />
        </div>
        <div className="form-row">
          <label className="axis-name" htmlFor="model-handle">Handle</label>
          <input
            id="model-handle"
            className="field"
            value={form.handle}
            onChange={(event) => set('handle', event.target.value.replace(/^@+/, ''))}
            placeholder="without the @"
          />
          {/* Not decoration: this is the key her own posts are matched on, so
              getting it wrong empties "her best posts" below without saying so. */}
          <span className="hint">
            How her own posts are found in the library, and the Instagram button
            above when no accounts are listed.
          </span>
        </div>
      </div>

      {form.photo_url && (
        <div className="form-row">
          <span className="axis-name">Photo</span>
          <span>
            <button className="btn btn-quiet btn-small" onClick={() => set('photo_url', null)}>
              Remove her photo
            </button>
          </span>
          <span className="hint">Tap the picture at the top to replace it instead.</span>
        </div>
      )}

      <SocialEditor socials={form.socials} onChange={(next) => set('socials', next)} />

      <FollowerLog
        modelId={modelId}
        socials={form.socials}
        handle={form.handle}
        readings={readings}
        onRecorded={onRecorded}
      />

      <TopPosts posts={posts} handle={form.handle} />

      {/* Only a professional (Business or Creator) account can ever authorise
          Insights, which is where views, saves and watch time come from. Asked
          at intake and answerable today — knowing which of the roster is still
          on a personal account is what makes the day the Meta app clears an
          afternoon's work rather than a survey. `unknown` is a real answer and
          stays the default: nobody has looked is not the same as no. */}
      <div className="form-row">
        <span className="axis-name">Her Instagram account</span>
        <div className="chips" role="group" aria-label="Instagram account type">
          {IG_CHOICES.map(([value, label]) => (
            <button
              key={value}
              className="chip"
              data-on={form.ig_account_type === value}
              aria-pressed={form.ig_account_type === value}
              onClick={() => set('ig_account_type', value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="hint">{IG_HINT[form.ig_account_type]}</span>
      </div>

      <IntakeDrop modelId={modelId} onApply={onIntake} />
    </>
  )
}
