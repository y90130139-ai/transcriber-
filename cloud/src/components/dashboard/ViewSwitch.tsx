export type DashView = 'instagram' | 'earnings'

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}

function MoneyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" x2="12" y1="2" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}

/** Instagram or Earnings: a two-option segmented switch with icons. It lives
 *  in each board's header, left of the period switch. */
export default function ViewSwitch({ value, onChange }: { value: DashView; onChange: (next: DashView) => void }) {
  return (
    <div className="viewswitch" role="group" aria-label="Dashboard view">
      <button type="button" className="viewswitch-item" data-on={value === 'instagram'}
        aria-pressed={value === 'instagram'} onClick={() => onChange('instagram')}>
        <InstagramIcon /><span>Instagram</span>
      </button>
      <button type="button" className="viewswitch-item" data-on={value === 'earnings'}
        aria-pressed={value === 'earnings'} onClick={() => onChange('earnings')}>
        <MoneyIcon /><span>Earnings</span>
      </button>
    </div>
  )
}
