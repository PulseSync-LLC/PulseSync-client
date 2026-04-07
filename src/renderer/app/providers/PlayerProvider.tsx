import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'

import trackInitials from '@entities/track/model/track.initials'
import PlayerContext from '@entities/track/model/player.context'
import UserContext from '@entities/user/model/context'
import { Track } from '@entities/track/model/track.interface'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'
import { areTracksEqual, normalizeTrack } from '@shared/lib/utils'
import OutgoingGatewayEvents from '@shared/api/socket/enums/outgoingGatewayEvents'
import type { PlayerProps } from '@app/AppShell.types'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import { buildStoreAddonMetrics } from '@entities/addon/lib/storeAddonMetrics'

export default function PlayerProvider({ children }: PlayerProps) {
    const { user, socket, socketConnected, emitGateway, addons } = useContext(UserContext)
    const { isExperimentEnabled, loading: experimentsLoading } = useExperiments()
    const [track, setTrack] = useState<Track>(trackInitials)
    const lastSentTrack = useRef({ title: null as string | null, status: null as string | null, progressPlayed: null as number | null })
    const lastSentAddonMetrics = useRef('')
    const lastSendAt = useRef(0)
    const trackSendingEnabled = !experimentsLoading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientTrackSending, false)
    const metricsSendingEnabled = !experimentsLoading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientMetricsSending, false)

    const handleSendTrackPlayedEnough = useCallback(
        (_event: any, data: any) => {
            if (!data) return
            if (!trackSendingEnabled) return
            if (socket && socket.connected) {
                emitGateway(OutgoingGatewayEvents.TRACK_PLAYED_ENOUGH, { track: { id: data.realId } })
            }
        },
        [socket, emitGateway, trackSendingEnabled],
    )

    const handleTrackInfo = useCallback((_: any, data: any) => {
        setTrack(prev => {
            const next = normalizeTrack(prev, data)
            if (areTracksEqual(prev, next)) return prev
            return next
        })
    }, [])

    useEffect(() => {
        if (user.id === '-1') return
        if (typeof window === 'undefined' || !(window as any).desktopEvents) return

        const de = (window as any).desktopEvents
        de.on(RendererEvents.SEND_TRACK, handleSendTrackPlayedEnough)
        de.on(RendererEvents.TRACK_INFO, handleTrackInfo)
        de.send(MainEvents.GET_TRACK_INFO)

        return () => {
            de.removeListener(RendererEvents.SEND_TRACK, handleSendTrackPlayedEnough)
            de.removeListener(RendererEvents.TRACK_INFO, handleTrackInfo)
        }
    }, [user.id, handleSendTrackPlayedEnough, handleTrackInfo])

    useEffect(() => {
        if (user.id !== '-1') return
        setTrack(trackInitials)
    }, [user.id])

    useEffect(() => {
        if (!socket || !trackSendingEnabled) return
        const title = track.title
        const status = track.status ?? ''
        const sourceType = track.sourceType
        const progressPlayed = track.progress?.position ?? null
        if (!title || sourceType === 'ynison' || !['playing', 'paused'].includes(status)) return

        const now = Date.now()
        if (now - lastSendAt.current < 1000) return

        const last = lastSentTrack.current
        if (last.title === title && last.status === status && last.progressPlayed === progressPlayed) return

        emitGateway(OutgoingGatewayEvents.SEND_TRACK, track)

        lastSentTrack.current = { title, status, progressPlayed }
        lastSendAt.current = now
    }, [socket, track, emitGateway, trackSendingEnabled])

    useEffect(() => {
        if (!socket || !socketConnected || !metricsSendingEnabled) return
        const enabledTheme = String((window as any)?.electron?.store?.get('addons.theme') || 'Default')
        const enabledScripts = Array.isArray((window as any)?.electron?.store?.get('addons.scripts'))
            ? ((window as any).electron.store.get('addons.scripts') as string[])
            : []
        const metrics = buildStoreAddonMetrics(addons, enabledTheme, enabledScripts)
        const serializedMetrics = JSON.stringify(metrics)

        if (lastSentAddonMetrics.current === serializedMetrics) {
            return
        }

        console.log('[AddonMetrics] send on socket connect/update', metrics)
        emitGateway(OutgoingGatewayEvents.SEND_METRICS, { addons: metrics })
        lastSentAddonMetrics.current = serializedMetrics
    }, [addons, emitGateway, metricsSendingEnabled, socket, socketConnected])

    return (
        <PlayerContext.Provider
            value={{
                currentTrack: track,
                setTrack,
            }}
        >
            {children}
        </PlayerContext.Provider>
    )
}
