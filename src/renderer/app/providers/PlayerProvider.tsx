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

export default function PlayerProvider({ children }: PlayerProps) {
    const { user, socket, features, emitGateway } = useContext(UserContext)
    const [track, setTrack] = useState<Track>(trackInitials)
    const lastSentTrack = useRef({ title: null as string | null, status: null as string | null, progressPlayed: null as number | null })
    const lastSendAt = useRef(0)

    const handleSendTrackPlayedEnough = useCallback(
        (_event: any, data: any) => {
            if (!data) return
            if (socket && socket.connected) {
                emitGateway(OutgoingGatewayEvents.TRACK_PLAYED_ENOUGH, { track: { id: data.realId } })
            }
        },
        [socket, emitGateway],
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
        if (!socket || !features.sendTrack) return
        const { title, status, sourceType, progress } = track

        const progressPlayed = progress?.position
        if (!title || sourceType === 'ynison' || !['playing', 'paused'].includes(status)) return

        const now = Date.now()
        if (now - lastSendAt.current < 1000) return

        const last = lastSentTrack.current
        if (last.title === title && last.status === status && last.progressPlayed === progressPlayed) return

        emitGateway(OutgoingGatewayEvents.SEND_TRACK, track)

        lastSentTrack.current = { title, status, progressPlayed }
        lastSendAt.current = now
    }, [socket, track, features.sendTrack, emitGateway])

    useEffect(() => {
        if (!socket) return

        const send = () => {
            if (!features.sendMetrics) return
            const enabledTheme = (window as any)?.electron?.store?.get('addons.theme')
            const enabledScripts = (window as any)?.electron?.store?.get('addons.scripts')
            emitGateway(OutgoingGatewayEvents.SEND_METRICS, { theme: enabledTheme || 'Default', scripts: enabledScripts || [] })
        }

        send()

        const id = setInterval(send, 15 * 60 * 1000)
        return () => clearInterval(id)
    }, [socket, features.sendMetrics, emitGateway])

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
