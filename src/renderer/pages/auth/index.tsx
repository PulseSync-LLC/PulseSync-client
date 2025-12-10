import AuthSummer from './summer/AuthSummer'
import AuthWinter from './winter/AuthWinter'

const AUTH_THEME: 'summer' | 'winter' = 'winter' // 'summer' | 'winter'

export default function AuthPage() {
    return AUTH_THEME === 'winter' ? <AuthWinter /> : <AuthSummer />
}
