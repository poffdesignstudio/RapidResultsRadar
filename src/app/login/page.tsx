import { ConfigAlert } from '../_components/ConfigAlert'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <div className="loginbox">
      <h1>Rapid <span style={{ color: 'var(--accent)' }}>Radar</span></h1>
      <ConfigAlert showOptional={false} />
      <div className="panel">
        <LoginForm disabled={!process.env.ADMIN_PASSWORD} />
      </div>
    </div>
  )
}
