# The Infloww re-ID, 2026-10-11

Infloww moved the agency onto new creator ids. All 31 ids we held were retired
and 58 new ones took their place — same people, new numbers, zero overlap
between the two sets. The retired rows stay in `earnings_accounts` (flagged
`missing_since`) so their 2304 `earnings_days` rows are never lost, but their
`model_id` was cleared on 2026-10-11: `reportables()` includes a missing
account and `runEarnings` pauses any model who has one, so leaving them
attached would have paused the whole roster permanently — a retired id never
comes back.

Each model’s pre-10-11 history therefore sits behind an id nothing points at.

> **Settled 2026-10-11 (later): no remap is needed, and none should be done.**
> The new ids carry the old history themselves. Helwife came back on a brand
> new id and her 120-day backfill returned 106 days reaching to 13 June — and
> against her retired id, 104 of those days overlap with 102 identical `net`
> figures (the two that differ are late-settling refunds the fresh pull has
> and the old rows do not). Infloww re-issued the numbers, not the ledger. So
> the retired rows are a duplicate of history we already hold under the live
> ids, which is also why they must stay unlinked: attaching them would double
> every model’s month. The table below is kept as the record of the move.

The original worry, for the record: `historyStart` comes from `max(first_day)`
across her live accounts, and backdating her history can fire milestone and
best-month notes retroactively. It does not arise, because nothing needs
backdating.

| Model | Retired account | Username | Retired id | Days | Her live account(s) now |
|---|---|---|---|---|---|
| Alexis Heart | Alexis Heart | @alexisheartt | `2110284769001534` | 85 | **none — gone from Infloww** |
| Bella Starr | Bella Starr | @sweetbrittx | `2579886627749919` | 75 | Bella Starr (2600569328238592) |
| Chelsea | Chelsea | @chelsearulebender | `2562687447990335` | 40 | Chelsea (2600568539512873) |
| Elizabeth | Elizabeth Suzanne | @misselizabethxox | `2461863661600802` | 38 | Elizabeth Suzanne (2600573689987095) |
| Erica Diggs | Erica Diggs | @diggsandco | `2547948294635580` | 115 | Erica Diggs (2600567130423306) |
| Faye West | Faye West | @unfilteredfae | `2565673775923231` | 65 | **none — gone from Infloww** |
| Helwife | helwife | @helwife | `2577111139418159` | 109 | **none — gone from Infloww** |
| Jane Goth | Jane Goth | @janegothxo | `2544854240591917` | 130 | Jane Goth (2600560268345346) |
| Jennzzxoxo | Jennifer | @jennzzxoxo | `2434688195362821` | 30 | Jennifer (2600575485214733) |
| Juno Mae | Juno Keller | @u580196812 | `2484391553663033` | 21 | Juno Mae (2600563657474055) |
| Kaytie Benz | Kaytie Benz | @kaytiebenz | `2565492464484374` | 59 | Kaytie Benz (2600571056095253) |
| Madylina | Madylina | @liina777 | `2562597304074294` | 114 | Madylina (2600566073196583) |
| Magnus | Magnus | @magnus0331 | `2424996115185727` | 59 | Magnus (2600572582756377) |
| Milky Sins | MILKY SINS | @milkysinss | `2214773957984293` | 130 | Milky Sins (2600573740449817) |
| Mona Faith | Mona Faith VIP | @monafaithvip | `2544857562677290` | 130 | Mona Faith VIP (2600580803657734), Monas Milkers (2600581810159636) |
| Mona Faith | MonasMilkers | @monasmilkers | `2333725123674137` | 54 | Mona Faith VIP (2600580803657734), Monas Milkers (2600581810159636) |
| Nikky Snoww | Nikky Snoww | @nikkysnowww | `2586210396930079` | 42 | Nikky Snoww (2600567683678217) |
| Nina Dolci | Nina Dolci VIP | @ninadolci | `2513313443741758` | 51 | Nina Dolci Free (2600564613840906), Nina Dolci VIP (2600565653635113) |
| Nina Dolci | Nina Dolci Free | @ninadolcixxx | `2527587012640780` | 60 | Nina Dolci Free (2600564613840906), Nina Dolci VIP (2600565653635113) |
| Rey Rey Marie | ReyRey Marie | @reyreymariefree | `2155264149356602` | 21 | **none — gone from Infloww** |
| Rey Rey Marie | Rey Rey VIP | @reyreymarie | `2106315497340986` | 125 | **none — gone from Infloww** |
| Snow | SNOW | @snowknowsbestxx | `2570198120923140` | 40 | SNOW (2600571089584146) |
| Sophia Savage | Sophia Savage VIP | @misssavagex | `2547914840866860` | 129 | Miss Savage VIP (2600566760931380) |
| xxbunniiixx | Blair Banks MAIN | @xxbunniiixx | `2542432029835320` | 48 | Blair Banks MAIN (2600562650841115) |

## No account on the new workspace

- **Alexis Heart** (Alexis Heart, @alexisheartt) — 85 days of history and nothing live to carry it to.
- **Faye West** (Faye West, @unfilteredfae) — 65 days of history and nothing live to carry it to.
- ~~**Helwife** (helwife, @helwife) — 109 days of history and nothing live to carry it to.~~
  **Back on 2026-10-11** as `Helena FS` (@helwife, `2603116545769521`), linked
  to her model row, 106 days pulled through 10-11 and $9,704.47 net over the
  window. A new id again, not the retired one.
- **Rey Rey Marie** (ReyRey Marie, @reyreymariefree) — 21 days of history and nothing live to carry it to.
- **Rey Rey Marie** (Rey Rey VIP, @reyreymarie) — 125 days of history and nothing live to carry it to.

The 7 accounts that were already unmatched before the move (Ivy Fox, Jordan Jay,
Lisa, Ruby, Scarlet Free, Sophie Maxson, Susanna Diaz) were retired with the rest
and never had a model.


## 2026-10-11 (later): four more accounts appeared, one of them hers

The key went from 58 creators to 62 while the roster was being fixed, which is
why this file now has a second date on it. All four were seeded, backfilled 120
days and pulled through 2026-10-11 with no errors:

| Account | Username | Id | Days | Model |
|---|---|---|---|---|
| Helena FS | @helwife | `2603116545769521` | 106 | **Helwife** |
| Ruby Chat | @goddessrubyclarke | `2603107385081864` | 93 | none — no model row |
| Lilith | @xxxlilithh | `2601529504759839` | 107 | none — no model row |
| Violette FS | @violette_nr | `2601824901201956` | 7 | none — no model row |

Only Helwife matched anything on the roster. **Ruby, Lilith and Violette have
no model row at all** — Ruby reads as another agency CHAT account like the
others transcriber does not track, but Lilith and Violette are own-name FS
pages with real money behind them (Lilith $6,314.51 over the window), which is
what a new model looks like. They are left unmatched rather than guessed at:
creating a model row is what puts someone on the roster, the sweep and the
Monday read, and that is Geno’s call, not a name match's.

Geno expects **4–5** new accounts in total, so one may still be coming — most
likely **Rey Rey Marie**, the one active model still with nothing on the new
workspace (146 days behind two retired ids).

The unmatched count is now **27**, and the Monday OPS nudge will name all of
them until someone says they are intentional.

## 2026-10-11 (later still): the seven unowned FS pages now have model rows

Geno: *"Add the new models and their cards to the transcriber, and upload their
profiles afterwards, but you can connect their OAuth accounts as we wait."*
That settles the question this file left open — the rows were his call, and he
made it.

**Who counted as a model.** The key's naming convention decides it, and the
data is unanimous: of the 62 live accounts, all 35 that are matched to a model
are `FS` / `VIP` / `MAIN` pages, and all 19 whose name contains `CHAT` are
unmatched — no exceptions in either direction. `CHAT` is an agency chatter
page, not a creator on the roster. So the seven unowned non-chatter pages got
rows and the nineteen chatter pages did not:

| Model row | Account | Id | Days | Net over the window |
|---|---|---|---|---|
| Kiera | Kiera FS | `2600304398958644` | 118 | $32,619.20 |
| Lilith | Lilith | `2601529504759839` | 107 | $6,314.51 |
| Tammylee | Tammylee FS | `2601567941296164` | 104 | $5,859.20 |
| Sarah Irene | Sarah Irene FS | `2600598084059151` | 102 | $1,494.61 |
| Jordan Jay | Jordan Jay FS | `2600588252545056` | 21 | $867.95 |
| Babygotcakes | Babygotcakes FS | `2600563875250192` | 29 | $842.40 |
| Violette | Violette FS | `2601824901201956` | 7 | $212.55 |

`Ruby Chat` (@goddessrubyclarke, $10,677.13) was the one hard call: it is the
biggest earner of the unowned pages, which is why this file previously hedged
on it. It stays unowned because the convention is the stronger evidence — the
name says `Chat`, and no `CHAT` account on the key has ever had a model.

**Jordan Jay has no row, on purpose.** She was one of the seven already
unmatched *before* the re-ID, so unlike the other six she had sat unowned for
over a month. A row was created here anyway — a live own-name page taking money
with nobody attributing it — with the caveat that deleting it was the fix if
there was a reason she never had one. Geno deleted it the same night and
confirmed on 2026-10-12: *"yeah i deleted jordan jay on purpose."* So
`Jordan Jay FS` (`2600588252545056`) stays unowned by design. **Do not
re-create it.** Her 21 days / $867.95 are untouched either way — `earnings_days`
is keyed by `infloww_id`, not by model.

**What was deliberately left empty.** `handle`, `photo_url` and the
format/persona/hook axes. `models.handle` is the *Instagram* handle — the
library joins on `lower(t.author) = lower(m.handle)` — so writing an Infloww
username into it would quietly attribute someone else's reels to her. Her
OnlyFans page needs no column at all: `withLinkedOnlyfans()` derives it from
the account match on every read, so linking the account is what makes the OF
button appear on her card.

**Nothing will be sent to them.** All seven have a null `telegram_chat_id`,
and `remindersDue()` filters on `telegram_chat_id is not null`, so no bot
message can reach them until Geno taps to link. `reportables()` went 31 → 38
and no model holds a missing account, so nobody is paused. The Sweep tab's
"active models with no formats ticked" figure went 6 → 13, which is the
correct signal rather than noise: it is now the to-do list for the profiles.

The unmatched count is **19**, and for the first time it is a clean invariant —
unmatched if and only if the account is a chatter page. The Monday OPS nudge
naming all nineteen is now expected and permanent, not a backlog.
