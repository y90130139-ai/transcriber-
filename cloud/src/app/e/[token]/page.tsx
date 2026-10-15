import { notFound } from 'next/navigation'
import { cardsForEditor } from '@/lib/editors'

export const dynamic = 'force-dynamic'

/**
 * An editor's page (Geno, 2026-10-07): everything assigned to them that
 * carries an editing note — the note, the file, the model's folder —
 * behind a token link like a model's plan, no login. In-house notes live
 * here and only here; her page never shows them.
 */
export default async function EditorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const sheet = await cardsForEditor(token)
  if (!sheet) notFound()

  const open = sheet.cards.filter((card) => !card.done)
  const done = sheet.cards.filter((card) => card.done)

  return (
    <main className="editor-sheet">
      <header>
        <p className="editor-eyebrow">Gosian Media · editing</p>
        <h1>{sheet.editor.name}</h1>
        <p className="editor-sub">
          {open.length === 0 ? 'Nothing waiting on you.' : `${open.length} piece${open.length === 1 ? '' : 's'} waiting.`}
        </p>
      </header>

      {open.map((card) => (
        <section className="editor-card" key={card.id}>
          <h2>
            {card.card} · {card.model}
            <span>week of {card.week_of}</span>
          </h2>
          {card.title && <p className="editor-title">{card.title}</p>}
          <p className="editor-notes">{card.notes}</p>
          {card.video && (
            <video controls playsInline preload="metadata" src={card.video} />
          )}
          <p className="editor-links">
            {card.download && <a href={card.download}>Download the file</a>}
            {card.folder && <a href={card.folder} target="_blank" rel="noreferrer">Her folder</a>}
            {card.creatorPlan && (
              <a href={card.creatorPlan} target="_blank" rel="noreferrer">Creator plan</a>
            )}
            {!card.video && !card.folder && <em>The file is not uploaded yet — it lands here when it is.</em>}
          </p>
        </section>
      ))}

      {done.length > 0 && (
        <details className="editor-done">
          <summary>Done · {done.length}</summary>
          {done.map((card) => (
            <p key={card.id}>{card.card} · {card.model} · week of {card.week_of}</p>
          ))}
        </details>
      )}
    </main>
  )
}
