import { useMemo } from 'react'
import AuthSummer from './summer/AuthSummer'
import AuthWinter from './winter/AuthWinter'
import { getSeasonByMSK } from '../../utils/seasonDetector'

export default function AuthPage() {
    const AUTH_THEME = useMemo(() => getSeasonByMSK(), [])

    return AUTH_THEME === 'winter' ? <AuthWinter /> : <AuthSummer />
}
