'use client'

import { useMemo, useState } from 'react'
import type { ApAccount } from '@/lib/autoposter'
import Avatar from '@/components/dashboard/Avatar'
import { Mark, platformLabel, profileUrlOf } from './marks'

/**
 * The connected accounts (Geno, 2026-10-14): every social account the token's
 * workspaces can publish to — one flat table with the profile photo, the
 * coloured platform mark, and a live link out. Read-only on purpose —
 * connecting or disconnecting stays dashboard-only.
 */
export default function AccountsTab({ configured, groups, coverage }: {
  configured: boolean
  groups: { id: string; accounts: ApAccount[] }[]
  coverage?: { loaded: number; total: number; failed: string[]; message?: string }
}) {
  const [query, setQuery] = useState('')

  const accounts = useMemo(() => {
    const rows: ApAccount[] = []
    const seen = new Set<string>()
    for (const group of groups) {
      for (const account of group.accounts) {
        const key = `${account.platform}:${account.name.toLowerCase()}:${account.id}`
        if (seen.has(key)) continue
        seen.add(key)
        rows.push(account)
      }
    }
    return rows.sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      if (byName !== 0) return byName
      return a.platform.localeCompare(b.platform)
    })
  }, [groups])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter((account) => (
      account.name.toLowerCase().includes(q)
      || account.platform.toLowerCase().includes(q)
      || platformLabel(account.platform).toLowerCase().includes(q)
    ))
  }, [accounts, query])

  const total = accounts.length

  return (
    <div className="dash sc-tab">
      <header className="dash-head">
        <div>
          <p className="dash-kicker">Scheduler</p>
          <h2 className="dash-title">Social accounts</h2>
          <p className="dash-sub">
            {total === 1 ? '1 account' : `${total} accounts`} connected — every post goes out through these.
          </p>
        </div>
        <div className="dash-head-tools">
          <a className="btn btn-small btn-quiet" href="https://autoposter.typamanagement.com" target="_blank" rel="noreferrer">
            Open Autoposter
          </a>
        </div>
      </header>

      {configured && coverage && coverage.failed.length > 0 ? (
        <p className="hint" role="status">
          {coverage.loaded} of {coverage.total} workspaces are synced. {coverage.message ?? 'The remaining workspaces will sync shortly.'}
        </p>
      ) : null}

      {!configured ? (
        <section className="dash-panel">
          <p className="hint" data-tone="bad" role="alert">
            The scheduler is not connected yet — add <code>AUTOPOSTER_TOKEN</code> and{' '}
            <code>AUTOPOSTER_WORKSPACE</code> to the environment, then reload.
          </p>
        </section>
      ) : total === 0 ? (
        <section className="dash-panel">
          <p className="dash-empty">No accounts connected. Connecting is dashboard-only — open Autoposter above.</p>
        </section>
      ) : (
        <section className="dash-panel sc-accounts-panel" aria-label="Social accounts">
          <div className="dash-panel-head dash-panel-head-flush sc-accounts-toolbar">
            <h2>
              Accounts <span>{filtered.length === total ? total : `${filtered.length} of ${total}`}</span>
            </h2>
            <input
              className="field"
              type="search"
              placeholder="Search accounts…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search accounts"
            />
          </div>
          <div className="dash-table-wrap">
            <table className="dash-table sc-accounts-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Platform</th>
                  <th scope="col">Profile</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((account) => {
                  const href = profileUrlOf(account.platform, account.name)
                  const label = platformLabel(account.platform)
                  return (
                    <tr key={`${account.platform}-${account.id}-${account.name}`}>
                      <th scope="row">
                        <span className="sc-acc-who">
                          <Avatar name={account.name} src={account.avatar} size={34} />
                          <span className="sc-acc-name">{account.name}</span>
                        </span>
                      </th>
                      <td>
                        <span className="sc-acc-platform">
                          <Mark platform={account.platform} name={account.name} size={14} />
                          <span>{label}</span>
                        </span>
                      </td>
                      <td>
                        {href ? (
                          <a
                            className="sc-acc-link"
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            title={href}
                          >
                            {href.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          </a>
                        ) : (
                          <span className="sc-acc-nolink">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="dash-empty">No accounts match that search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
