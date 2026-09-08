import { isSignedIn } from '@/lib/auth'
import Gate from '@/components/Gate'
import Workbench from '@/components/Workbench'

export const dynamic = 'force-dynamic'

export default async function Home() {
  return (await isSignedIn()) ? <Workbench /> : <Gate />
}
