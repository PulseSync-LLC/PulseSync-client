import { useEffect, useState } from 'react'

import { desktopApi } from '@shared/desktop/desktopApi'

import type { DesktopAddonRecoverySnapshot } from '@common/addons/recovery'

export function useAddonRecovery() {
    const [snapshot, setSnapshot] = useState<DesktopAddonRecoverySnapshot>({ connection: 'loading', entries: [] })

    useEffect(() => {
        let active = true
        let received = false
        const unsubscribe = desktopApi.addons.onRecoveryChange(next => {
            received = true
            if (active) setSnapshot(next)
        })
        void desktopApi.addons.getRecoverySnapshot().then(
            next => {
                if (active && !received) setSnapshot(next)
            },
            () => {
                if (active && !received) setSnapshot({ connection: 'disconnected', entries: [] })
            },
        )
        return () => {
            active = false
            unsubscribe()
        }
    }, [])

    return snapshot
}
