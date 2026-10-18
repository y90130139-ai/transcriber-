import { requirePage } from '@/lib/access'
import InboxTab from '@/components/roster/InboxTab'

/** The team's inbox: threads with models, group chats, photos and videos. */
export default async function InboxPage() {
  await requirePage('inbox')
  return <InboxTab />
}
