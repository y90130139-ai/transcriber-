import { requirePage } from '@/lib/access'
import SettingsTab from '@/components/console/SettingsTab'

/** The rail's Settings row (Geno, 2026-10-13). */
export default async function SettingsPage() {
  await requirePage('settings')
  return <SettingsTab />
}
