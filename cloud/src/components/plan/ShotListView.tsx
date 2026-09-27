import type { ShotList } from '@/lib/shotlist'

const secs = (from: number, to: number) => `${from}–${to}s`

/**
 * "Film it" as a numbered shot list: the setup in chips, then per shot what
 * the camera does, what happens, what to show and what to say. Few words on
 * purpose — most people will not read a paragraph (Geno, 2026-09-27).
 */
export default function ShotListView({ list, face }: { list: ShotList; face: string }) {
  const firstYou = list.steps.find((step) => step.you)?.no
  return (
    <div className="plan-shots">
      <ul className="plan-shot-chips" aria-label="Setup">
        {list.chips.map((chip) => <li key={chip}>{chip}</li>)}
      </ul>
      <ol className="plan-shot-list">
        {list.steps.map((step) => (
          <li key={step.no} className="plan-shot" data-you={step.you || undefined}>
            <p className="plan-shot-head">
              <b>Shot {step.no}</b>
              <span>{secs(step.from, step.to)}</span>
              <span className="plan-shot-who">{step.you ? 'You' : 'Not you — a clip'}</span>
            </p>
            <p className="plan-shot-camera">{step.camera}</p>
            {step.what && <p className="plan-shot-what">{step.what}</p>}
            {step.show && (
              <p className="plan-shot-line"><span>Show</span>&ldquo;{step.show}&rdquo; <em>— your version</em></p>
            )}
            {step.say && (
              <p className="plan-shot-line"><span>Say</span>&ldquo;{step.say}&rdquo; <em>— your words</em></p>
            )}
            {step.no === firstYou && <p className="plan-shot-line"><span>Face</span>{face}</p>}
          </li>
        ))}
      </ol>
      <p className="plan-shot-line plan-shot-sound"><span>Sound</span>{list.sound}</p>
    </div>
  )
}
