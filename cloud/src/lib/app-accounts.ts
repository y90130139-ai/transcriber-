/** The app-accounts list, composed server-side (Geno, 2026-10-13).
 *
 * Accounts and passwords live in Supabase (`lib/model-accounts.ts`); the
 * model each one is linked to — her name and photo — lives in Neon. The two
 * meet at the model id. Read by the page's first render and by the tab's
 * refresh after an action, so both always agree.
 *
 * 2026-10-14: the list gained each account's device count and freshest
 * device, and `loadAppAccountDetail` was added — everything one creator's
 * account page needs: the account, the model, her devices, her whole
 * activity timeline (`lib/app-activity.ts`), her questionnaire answers and
 * the intake on file.
 */
import { appEmailConfigured } from '@/lib/app-email'
import { activityForModel, type ActivityEvent } from '@/lib/app-activity'
import { sql } from '@/lib/db'
import { listAccounts, findAccountForModel, getAccount, type ModelAccount } from '@/lib/model-accounts'

export type AppAccountRow = ModelAccount & {
  modelName: string | null
  modelPhoto: string | null
  modelHandle: string | null
  /** Push devices that were live the last time they were seen. */
  devices: number
  /** When any of her devices was last seen. */
  deviceLastSeen: string | null
}

type DeviceSummary = { n: number; last: string | null }

export async function loadAppAccounts(): Promise<{ accounts: AppAccountRow[]; emailConfigured: boolean }> {
  const accounts = await listAccounts()

  const modelIds = [...new Set(accounts.map((account) => account.modelId).filter((id): id is string => Boolean(id)))]
  const people = new Map<string, { name: string; photo: string | null; handle: string | null }>()
  const devices = new Map<string, DeviceSummary>()
  if (modelIds.length > 0) {
    const [rows, deviceRows] = await Promise.all([
      sql.query(
        `select id, name, photo_url, handle from transcriber.models where id = any($1::text[])`,
        [modelIds],
      ),
      sql.query(
        `select model_id, count(*)::int as n, max(last_seen_at) as last
           from transcriber.model_devices where model_id = any($1::text[])
          group by model_id`,
        [modelIds],
      ),
    ])
    for (const row of rows) {
      people.set(String(row.id), {
        name: String(row.name),
        photo: row.photo_url ? String(row.photo_url) : null,
        handle: row.handle ? String(row.handle) : null,
      })
    }
    for (const row of deviceRows) {
      devices.set(String(row.model_id), {
        n: Number(row.n ?? 0),
        last: row.last ? (row.last instanceof Date ? row.last.toISOString() : String(row.last)) : null,
      })
    }
  }

  return {
    accounts: accounts.map((account) => {
      const person = account.modelId ? people.get(account.modelId) : undefined
      const device = account.modelId ? devices.get(account.modelId) : undefined
      return {
        ...account,
        modelName: person?.name ?? null,
        modelPhoto: person?.photo ?? null,
        modelHandle: person?.handle ?? null,
        devices: device?.n ?? 0,
        deviceLastSeen: device?.last ?? null,
      }
    }),
    emailConfigured: appEmailConfigured(),
  }
}

/** One payload she submitted from the app — the agreement, the contact
 *  form, the intake form. `data` is whatever the phone sent; the console
 *  renders it read-only. */
export type AppSubmission = { kind: string; data: Record<string, unknown>; created_at: string }

/** The three first-run milestones (Geno, 2026-10-14): accepted the invite,
 *  completed the tour, completed the onboarding. Null until each one lands. */
export type AppMilestones = {
  invite_at: string | null
  tour_at: string | null
  onboarding_at: string | null
}

/** Everything her account page renders, in one read. */
export type AppAccountDetail = {
  account: ModelAccount
  model: {
    id: string
    name: string
    handle: string | null
    photo_url: string | null
    status: string
    timezone: string | null
    created_at: string | null
  } | null
  devices: { id: string; platform: string | null; created_at: string; last_seen_at: string }[]
  activity: ActivityEvent[]
  milestones: AppMilestones
  /** Latest submission per kind; history stays in the table. */
  submissions: AppSubmission[]
  survey: {
    sent_at: string | null
    opened_at: string | null
    submitted_at: string | null
    answers: Record<string, unknown> | null
  } | null
  intake: { filename: string | null; created_at: string; applied_at: string | null }[]
}

/** The account's own timestamps join the timeline, where the account is in
 *  hand — the activity lib stays database-only. */
function accountEventsOf(account: ModelAccount | null): ActivityEvent[] {
  const events: ActivityEvent[] = []
  if (account?.setupSentAt) {
    events.push({
      at: account.setupSentAt,
      kind: 'invite',
      by: 'team',
      label: `Invite sent${account.setupSendCount > 1 ? ` (${account.setupSendCount}×)` : ''}`,
      detail: account.email,
    })
  }
  if (account?.activatedAt) {
    events.push({ at: account.activatedAt, kind: 'activated', by: 'her', label: 'Accepted the invite', detail: 'Set her password' })
  }
  return events
}

/** The three first-run milestones — from the account and from the events her
 *  phone reported. Activity is newest-first, so `find` keeps the latest. */
function milestonesOf(account: ModelAccount | null, activity: ActivityEvent[]): AppMilestones {
  return {
    invite_at: account?.activatedAt ?? null,
    tour_at: activity.find((event) => event.kind === 'tour')?.at ?? null,
    onboarding_at: activity.find((event) => event.kind === 'onboarding')?.at ?? null,
  }
}

/**
 * The detail page's read (Geno, 2026-10-14).
 *
 * `id` is the model id in the usual case — every table the timeline reads is
 * model-keyed, and the account is found through it. An account id is accepted
 * too, so an account that is not linked to a model yet can still open its own
 * page (its model-keyed reads come back empty); that is also the page where
 * it gets linked.
 */
export async function loadAppAccountDetail(id: string): Promise<AppAccountDetail | null> {
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null

  const byModel = await detailForModel(id)
  if (byModel) return byModel

  const account = await getAccount(id)
  if (!account) return null
  return {
    account,
    model: null,
    devices: [],
    activity: accountEventsOf(account),
    milestones: milestonesOf(account, []),
    submissions: [],
    survey: null,
    intake: [],
  }
}

/** Everything keyed by a model. Null when the id names no model and no
 *  account — the caller then tries it as an account id. */
async function detailForModel(modelId: string): Promise<AppAccountDetail | null> {
  const [account, modelRows, deviceRows, surveyRows, intakeRows, activity, submissionRows] = await Promise.all([
    findAccountForModel(modelId),
    sql.query(
      `select id, name, handle, photo_url, status, timezone,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
         from transcriber.models where id = $1`,
      [modelId],
    ),
    sql.query(
      `select id, platform,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              to_char(last_seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_seen_at
         from transcriber.model_devices where model_id = $1
        order by last_seen_at desc limit 20`,
      [modelId],
    ),
    sql.query(
      `select to_char(sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as sent_at,
              to_char(opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as opened_at,
              to_char(submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as submitted_at,
              answers
         from transcriber.surveys where model_id = $1
        order by created_at desc limit 1`,
      [modelId],
    ),
    sql.query(
      `select filename,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              to_char(applied_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as applied_at
         from transcriber.model_intake where model_id = $1
        order by created_at desc limit 20`,
      [modelId],
    ),
    activityForModel(modelId),
    sql.query(
      `select kind, data,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
         from transcriber.app_submissions
        where model_id = $1
        order by created_at desc limit 40`,
      [modelId],
    ),
  ])

  const model = modelRows[0]
  if (!account && !model) return null

  const accountEvents = accountEventsOf(account)
  const milestones = milestonesOf(account, activity)

  // Latest submission per kind; a re-sent form replaces what the console shows.
  const latestSubmissions = new Map<string, AppSubmission>()
  for (const row of submissionRows) {
    const kind = String(row.kind)
    if (latestSubmissions.has(kind)) continue
    latestSubmissions.set(kind, {
      kind,
      data: row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : {},
      created_at: String(row.created_at),
    })
  }

  return {
    account: account ?? {
      id: '',
      email: '',
      name: model ? String(model.name) : null,
      modelId,
      status: 'invited',
      setupSentAt: null,
      setupSendCount: 0,
      lastLoginAt: null,
      activatedAt: null,
      createdAt: null,
    },
    model: model
      ? {
          id: String(model.id),
          name: String(model.name),
          handle: model.handle ? String(model.handle) : null,
          photo_url: model.photo_url ? String(model.photo_url) : null,
          status: String(model.status),
          timezone: model.timezone ? String(model.timezone) : null,
          created_at: model.created_at ? String(model.created_at) : null,
        }
      : null,
    devices: deviceRows.map((row) => ({
      id: String(row.id),
      platform: row.platform ? String(row.platform) : null,
      created_at: String(row.created_at),
      last_seen_at: String(row.last_seen_at),
    })),
    activity: [...accountEvents, ...activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 250),
    milestones,
    submissions: [...latestSubmissions.values()],
    survey: surveyRows[0]
      ? {
          sent_at: surveyRows[0].sent_at ? String(surveyRows[0].sent_at) : null,
          opened_at: surveyRows[0].opened_at ? String(surveyRows[0].opened_at) : null,
          submitted_at: surveyRows[0].submitted_at ? String(surveyRows[0].submitted_at) : null,
          answers: surveyRows[0].answers && typeof surveyRows[0].answers === 'object'
            ? (surveyRows[0].answers as Record<string, unknown>)
            : null,
        }
      : null,
    intake: intakeRows.map((row) => ({
      filename: row.filename ? String(row.filename) : null,
      created_at: String(row.created_at),
      applied_at: row.applied_at ? String(row.applied_at) : null,
    })),
  }
}
