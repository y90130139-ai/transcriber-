'use client'

import { instagramAccounts, type Social } from '@/lib/socials'
import Scorecard from '../../Scorecard'

/**
 * How each of her Instagram accounts is doing, one scorecard apiece.
 *
 * She may run three; the roster pass reads all of them, and the only way to
 * see which one is winning is to keep them apart. A combined figure would
 * average a main account against a backup nobody posts to and describe
 * neither.
 *
 * The scorecards fill once the roster pass has read her — they say "nothing
 * swept yet" until then rather than showing a zero that looks like a miss.
 */
export default function Accounts({ handle, socials }: { handle: string; socials: Social[] }) {
  const accounts = instagramAccounts(handle, socials)
  if (accounts.length === 0) {
    return (
      <div className="form-row">
        <span className="axis-name">Her accounts</span>
        <span className="hint">
          No Instagram yet. Add her handle above, or a link below, and the roster pass
          will start measuring her.
        </span>
      </div>
    )
  }

  return (
    <div className="accounts">
      <div className="form-row">
        <span className="axis-name">Her accounts</span>
        <span className="hint">
          {accounts.length === 1
            ? 'One Instagram. Every account listed below gets read and scored on its own.'
            : `${accounts.length} Instagram accounts, each measured on its own — that is how you see which one is winning.`}
        </span>
      </div>
      {accounts.map((account, index) => (
        <section key={account} className="account" aria-label={`@${account}`}>
          <div className="account-head">
            <a href={`https://www.instagram.com/${account}/`} target="_blank" rel="noreferrer">
              @{account}
            </a>
            {index === 0 && <span className="chip chip-static">main</span>}
          </div>
          <Scorecard handle={account} />
        </section>
      ))}
    </div>
  )
}
