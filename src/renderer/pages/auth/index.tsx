import { useMemo } from 'react'
import AuthSummer from './summer/AuthSummer'
import AuthWinter from './winter/AuthWinter'
import AuthDefault from './default/Auth'
import { getSeasonByMSK } from '../../utils/seasonDetector'

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
