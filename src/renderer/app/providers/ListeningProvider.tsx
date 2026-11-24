import { createContext, useContext, useEffect, useState } from 'react'

import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import UserContext from '@entities/user/model/context'
import { desktopApi } from '@shared/desktop/desktopApi'

import type { ListeningView } from '@common/listening/types'
import type { PropsWithChildren } from 'react'

const empty: ListeningView = { available: false, connection: 'idle', userId: null, room: null, modReady: false, error: null }
const Context = createContext<ListeningView & { loading: boolean }>({ ...empty, loading: true })
export const useListening = () => useContext(Context)
export default function ListeningProvider({ children }: PropsWithChildren) {
    const { user, isAutonomousMode } = useContext(UserContext)
    const { loading, isExperimentEnabled } = useExperiments()
    const enabled =
        !loading && !isAutonomousMode && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientListenTogether, false) && desktopApi.listening.supported()
    const [state, setState] = useState<ListeningView>(empty)
    const [resolved, setResolved] = useState('')
    const [identity, setIdentity] = useState('')
    useEffect(() => {
        setState(empty)
        setResolved('')
        if (!enabled) return
        let current = true
        const unsubscribe = desktopApi.listening.onChange(view => {
            if (!current) return
            setIdentity(user.id)
            setState(view)
            if (view.open && view.available) window.location.hash = '/joint'
        })
        void desktopApi.listening
            .get()
            .then(view => {
                if (current) {
                    setIdentity(user.id)
                    setState(view)
                    setResolved(user.id)
                }
            })
            .catch(() => {
                if (current) setResolved(user.id)
            })
        return () => {
            current = false
            unsubscribe()
            void desktopApi.listening.stop().catch(() => {})
        }
    }, [enabled, user.id])
    return (
        <Context.Provider value={{ ...(enabled && identity === user.id ? state : empty), loading: enabled && resolved !== user.id }}>
            {children}
        </Context.Provider>
    )
}
