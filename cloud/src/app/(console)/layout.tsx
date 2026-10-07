import { isSignedIn } from '@/lib/auth'
import Gate from '@/components/Gate'
import { ConsoleProvider } from '@/components/console/ConsoleProvider'
import ConsoleShell from '@/components/console/ConsoleShell'

export const dynamic = 'force-dynamic'

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSignedIn())) return <Gate />
  return (
    <ConsoleProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </ConsoleProvider>
  )
}
