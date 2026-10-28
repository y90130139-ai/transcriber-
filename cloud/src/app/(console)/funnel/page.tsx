import { requirePage } from '@/lib/access'
import { loadFunnel } from '@/lib/funnel'
import FunnelPanel from '@/components/FunnelPanel'

/** Whether each model's traffic has somewhere to land.
 *
 *  Deliberately action-first. The board this replaces carried the same facts
 *  and Geno stopped opening it: "when you're overwhelmed with information, it
 *  makes you not want to do anything." So the top of this page is four things
 *  to do, ranked by the money behind them, and the sixty-row table lives
 *  underneath for when the answer is not already on screen.
 *
 *  Server-rendered like the rest of the console, and session-gated here as
 *  well as in the layout: a server render travels in the response payload, so
 *  an unauthenticated request must never carry the rows.
 */
export default async function FunnelPage() {
  await requirePage('funnel')
  const view = await loadFunnel()
  return (
    <div className="dash">
      <header className="dash-head dash-head-flush">
        <div>
          <h2 className="dash-title">Funnel</h2>
          <p className="dash-sub">
            Three surfaces can carry a link and only one has to work: the bio, a
            highlight, a live story. A model with none of them is posting into a
            dead end.
          </p>
        </div>
      </header>
      <FunnelPanel view={view} />
    </div>
  )
}
