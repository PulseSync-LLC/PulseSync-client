import { useMemo } from 'react'
import AuthSummer from '@pages/auth/summer/AuthSummer'
import AuthWinter from '@pages/auth/winter/AuthWinter'
import AuthDefault from '@pages/auth/default/Auth'
import { getSeasonByMSK } from '@shared/lib/seasonDetector'

export default function AuthPage() {
    const AUTH_THEME = useMemo(() => getSeasonByMSK(), [])
    if (AUTH_THEME === 'summer') {
        return <AuthSummer />
    } else if (AUTH_THEME === 'winter') {
        return <AuthWinter />
    } else {
        return <AuthDefault />
    }
}
