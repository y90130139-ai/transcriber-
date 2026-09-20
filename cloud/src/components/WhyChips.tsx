import { REASON_NAME, reasonChip, reasonLine, type Why } from '@/lib/reasons'

/** What carried a winner, as chips — and the leading reason spelled out as a
 *  visible line, because a `title` tooltip does nothing on a phone. */
export default function WhyChips({ why }: { why: Why | null | undefined }) {
  if (!why || why.reasons.length === 0) return null
  const [lead] = why.reasons
  return (
    <div className="why" aria-label="Why it worked">
      <div className="chips">
        {why.reasons.map((reason) => (
          <span
            key={reason.kind}
            className="chip chip-static why-chip"
            data-kind={reason.kind}
            title={`${REASON_NAME[reason.kind]} — ${reasonLine(reason)}`}
          >
            {reasonChip(reason)}
          </span>
        ))}
      </div>
      <p className="why-line">{reasonLine(lead)}</p>
    </div>
  )
}
