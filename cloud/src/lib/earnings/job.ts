/**
 * The daily earnings run (2026-09-30): pull, store, then draft.
 *
 *   1. Sync the account list with Infloww; an account that vanished is an OPS
 *      alert and drops out of reporting until it comes back.
 *   2. Pull each account up to today. A new account is backfilled 120 days
 *      (enough for "best in 90 days" plus the 28-day median) in 30-day
 *      windows, each saved as it lands, so a run that runs out of time keeps
 *      its progress. Every run re-pulls the last 4 days: OnlyFans settles and
 *      reverses up to ~3 days late.
 *   3. Draft, once every matched model is pulled through yesterday: a win note
 *      for yesterday, and on Mondays the week just ended. Drops over 25% and
 *      unsendable models become OPS alerts.
 *
 * Nothing goes to a creator from here. Drafts wait for Approve in OPS unless
 * EARNINGS_AUTOSEND=1.
 */
import { addDays, dayOf, foldDays, startOfDay } from './days'
import { foldFans, pickQuiet, winbackText } from './winback'
import { firstOfMonth, lastOfMonth, milestoneText, milestonesFor, recapFor, recapText } from './monthly'
import { BACKFILL_DAYS, isCurrent, nextWindow, windowEnd } from './window'
import { listCreators, OutOfTime, transactions } from './infloww'
import { RULES, dayDrop, money, weeklyNumbers, weeklyText, winFor, winText } from './report'
import {
  alert, combinedDays, draftMessage, loadAccounts, milestoneCodes, quietFans, notePullError, reportables, saveDays, syncAccounts, winsInWeek,
  type Account,
} from './store'


export type RunResult = {
  today: string
  pulled: { name: string; through: string }[]
  errors: { name: string; error: string }[]
  complete: boolean
  drafted: string[]
  alerts: number
}

export async function runEarnings({ deadline, now = Date.now(), draft = true }: { deadline: number; now?: number; draft?: boolean }): Promise<RunResult> {
  const today = dayOf(now)
  const result: RunResult = { today, pulled: [], errors: [], complete: false, drafted: [], alerts: 0 }

  const { gone, back } = await syncAccounts(await listCreators(deadline))
  for (const a of gone) {
    await alert(`gone:${a.infloww_id}:${today}`, `⚠️ ${a.name} (@${a.username}) is no longer on Infloww. Their earnings reports are paused until the account is connected again.`)
    result.alerts++
  }
  for (const a of back) {
    await alert(`back:${a.infloww_id}:${today}`, `✅ ${a.name} (@${a.username}) is back on Infloww. Reports resume.`)
    result.alerts++
  }

  try {
    for (const a of (await loadAccounts()).filter((x) => !x.missing_since)) {
      let account: Pick<Account, 'pulled_through' | 'pulled_at'> = a
      for (let w = nextWindow(account, today); w; w = nextWindow(account, today)) {
        try {
          const txns = await transactions(a.infloww_id, startOfDay(w.from), windowEnd(w.to, Date.now()), deadline)
          await saveDays(a.infloww_id, w.from, w.to, foldDays(txns), w.to, w.from, foldFans(txns))
          account = { pulled_through: w.to, pulled_at: new Date().toISOString() }
        } catch (error) {
          if (error instanceof OutOfTime) throw error
          const message = error instanceof Error ? error.message : String(error)
          await notePullError(a.infloww_id, message)
          result.errors.push({ name: a.name, error: message })
          break
        }
      }
      if (account.pulled_through) result.pulled.push({ name: a.name, through: account.pulled_through })
    }
    result.complete = true
  } catch (error) {
    if (!(error instanceof OutOfTime)) throw error
  }

  if (result.complete && draft) await draftAll(today, result)
  return result
}

const autosend = () => process.env.EARNINGS_AUTOSEND === '1'

async function draftAll(today: string, result: RunResult) {
  const yesterday = addDays(today, -1)
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay() // 1 = Monday
  const thisMonday = addDays(today, -((weekday + 6) % 7))
  const lastMonday = addDays(thisMonday, -7)

  // Accounts Infloww has but nobody matched: an OPS nudge once a week.
  const unmatched = (await loadAccounts()).filter((a) => !a.model_id && !a.missing_since)
  if (unmatched.length) {
    await alert(`unmatched:${thisMonday}`, `🔗 ${unmatched.length} Infloww account${unmatched.length === 1 ? ' is' : 's are'} not matched to a model, so no reports go out for ${unmatched.length === 1 ? 'it' : 'them'}: ${unmatched.map((a) => a.name).join(', ')}. Match them in the portal under Dashboard → Earnings.`)
    result.alerts++
  }

  // Monday (or Tue/Wed if Monday's run did not finish): big spenders gone
  // quiet, one OPS-only post per week. Never to a creator.
  if (weekday >= 1 && weekday <= 3) {
    const text = winbackText(pickQuiet(await quietFans(today)), thisMonday)
    if (text) {
      await alert(`winback:${thisMonday}`, text)
      result.alerts++
    }
  }

  for (const r of await reportables()) {
    // Every account behind her must be connected and freshly, cleanly pulled,
    // or her numbers are partial — and partial numbers are never sent.
    const gone = r.accounts.filter((a) => a.missing_since)
    if (gone.length) {
      await alert(`partial:${r.model_id}:${today}`, `⏸ ${r.model_name}: ${gone.map((a) => a.name).join(', ')} is gone from Infloww, so her reports are paused rather than sent on part of her money.`)
      result.alerts++
      continue
    }
    const stale = r.accounts.filter((a) => !isCurrent(a, today))
    if (stale.length) {
      await alert(`stale:${r.model_id}:${today}`, `⏸ ${r.model_name}: today's pull failed for ${stale.map((a) => a.name).join(', ')}${stale[0].pull_error ? ` (${stale[0].pull_error.slice(0, 120)})` : ''}. Nothing was drafted for her today.`)
      result.alerts++
      continue
    }
    const historyStart = r.accounts.map((a) => a.first_day ?? today).sort().at(-1)!
    // Everything we hold, not a rolling window: "best month on record" must
    // compare against whole months, and old day rows are never deleted.
    const history = await combinedDays(r.accounts.map((a) => a.infloww_id), historyStart)
    const floor = Math.max(...r.accounts.map((a) => a.win_floor_cents ?? RULES.winFloorCents))

    if (!r.chat_id) {
      await alert(`nochat:${r.model_id}:${thisMonday}`, `📭 ${r.model_name} has earnings but no Telegram group linked, so nothing can be sent. Link her group in the portal.`)
      result.alerts++
    }

    // Internal: a day down more than 25%.
    const drop = dayDrop(history, yesterday)
    if (drop) {
      await alert(`daydrop:${r.model_id}:${yesterday}`, `📉 ${r.model_name}: ${money(drop.net)} net yesterday vs ${money(drop.prevNet)} the day before (${drop.change}%).`)
      result.alerts++
    }

    // Win note for yesterday, at most two a week.
    const win = winFor(history, yesterday, historyStart, floor)
    // The cap counts the week the win day is in: on Monday that is last week.
    const winMonday = addDays(yesterday, -((new Date(`${yesterday}T12:00:00Z`).getUTCDay() + 6) % 7))
    if (win && r.chat_id && (await winsInWeek(r.model_id, winMonday, addDays(winMonday, 6))) < RULES.winsPerWeek) {
      const made = await draftMessage({
        key: `win:${r.model_id}:${yesterday}`, kind: 'win', model_id: r.model_id, chat_id: r.chat_id,
        period: yesterday, body: winText(win, `${r.model_id}${yesterday}`), numbers: win, approved: autosend(),
      })
      if (made) result.drafted.push(`win ${r.model_name}`)
    }

    // Milestones crossed yesterday, one message however many.
    if (r.chat_id) {
      const month = firstOfMonth(yesterday)
      const ms = milestonesFor(history, yesterday, historyStart, await milestoneCodes(r.model_id, month, lastOfMonth(month)))
      if (ms.length) {
        const made = await draftMessage({
          key: `milestone:${r.model_id}:${yesterday}`, kind: 'milestone', model_id: r.model_id, chat_id: r.chat_id,
          period: yesterday, body: milestoneText(ms), numbers: { codes: ms.map((m) => m.code) }, approved: autosend(),
        })
        if (made) result.drafted.push(`milestone ${r.model_name}`)
      }
    }

    // The 1st: the month just ended, if we hold all of it.
    // The 1st, or the 2nd/3rd if the 1st's pull failed; the key keeps it once.
    const recapMonth = firstOfMonth(addDays(firstOfMonth(today), -1))
    if (Number(today.slice(8)) <= 3 && r.chat_id && historyStart <= recapMonth) {
      const recap = recapFor(history, recapMonth, historyStart)
      const made = await draftMessage({
        key: `monthly:${r.model_id}:${recapMonth}`, kind: 'monthly', model_id: r.model_id, chat_id: r.chat_id,
        period: recapMonth, body: recapText(recap), numbers: recap, approved: autosend(),
      })
      if (made) result.drafted.push(`monthly ${r.model_name}`)
    }

    // Monday: the week just ended.
    if (weekday === 1 && historyStart <= lastMonday) {
      const n = weeklyNumbers(history, lastMonday, historyStart)
      if (r.chat_id) {
        const made = await draftMessage({
          key: `weekly:${r.model_id}:${lastMonday}`, kind: 'weekly', model_id: r.model_id, chat_id: r.chat_id,
          period: lastMonday, body: weeklyText(n, `${r.model_id}${lastMonday}`), numbers: n, approved: autosend(),
        })
        if (made) result.drafted.push(`weekly ${r.model_name}`)
      }
      if (n.dropAlert) {
        await alert(`weekdrop:${r.model_id}:${lastMonday}`, `📉 ${r.model_name}: ${money(n.net)} net last week vs ${money(n.prevNet)} the week before (${n.change}%).`)
        result.alerts++
      }
    }
  }
}
