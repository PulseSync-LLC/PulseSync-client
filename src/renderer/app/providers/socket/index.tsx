import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useModalContext } from '@app/providers/modal'
import { createGatewayHandler } from '@app/providers/socket/gateway'
import { useZstdCodec } from '@app/providers/socket/useZstdCodec'
import { buildRealtimeSocketAuth, CONNECTION_ERROR_TOAST_THRESHOLD, emitCompressedGateway } from '@app/providers/socket/utils'
import IncomingSocketEvents from '@shared/api/socket/enums/incomingSocketEvents'
import { createRealtimeSocket, reconnectOnAuthExpiry, updateRealtimeSocketAuth } from '@shared/api/socket/realtimeSocket'
import { desktopApi } from '@shared/desktop/desktopApi'
import toast from '@shared/ui/toast'

import type { SocketContextValue, SocketProviderProps } from '@app/providers/socket/types'
import type { DesktopRuntimeInfo } from '@common/desktopApi/contract'
import type { OutgoingGatewayEvent } from '@shared/api/socket/enums/outgoingGatewayEvents'
import type { Socket } from 'socket.io-client'

const noopEmitGateway = (_event: OutgoingGatewayEvent, _payload: unknown): void => {}

const defaultSocketContextValue: SocketContextValue = {
    socket: null,
    socketConnected: false,
    emitGateway: noopEmitGateway,
}

const SocketContext = createContext<SocketContextValue>(defaultSocketContextValue)

export function useSocketContext() {
    return useContext(SocketContext)
}

export function SocketProvider({
    userId,
    appVersion,
    setUser,
    onLogout,
    onAchievementsUpdate,
    onAddonStoreUpdated,
    onNotificationCreated,
    onNotificationRead,
    onNotificationsReadAll,
    children,
}: SocketProviderProps) {
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()
    const [socket, setSocket] = useState<Socket | null>(null)
    const [socketConnected, setSocketConnected] = useState(false)
    const [desktopRuntimeInfo, setDesktopRuntimeInfo] = useState<DesktopRuntimeInfo | null>(null)
    const { zstdReady, zstdRef } = useZstdCodec()

    const socketRef = useRef<Socket | null>(null)
    const websocketStartedRef = useRef(false)
    const connectionErrorAttemptsRef = useRef(0)
    const unavailableToastShownRef = useRef(false)
    const authExpiredRef = useRef(false)

    const emitGateway = useCallback(
        (event: OutgoingGatewayEvent, payload: unknown) => {
            emitCompressedGateway({
                socket: socketRef.current,
                zstdReady,
                zstd: zstdRef.current,
                event,
                payload,
            })
        },
        [zstdReady],
    )

    useEffect(() => {
        if (typeof window === 'undefined') return
        if (websocketStartedRef.current) return

        websocketStartedRef.current = true
        desktopApi.system.startWebsocket()
    }, [])

    useEffect(() => {
        let active = true
        desktopApi.getRuntimeInfo().then(runtimeInfo => {
            if (active) {
                setDesktopRuntimeInfo(runtimeInfo)
            }
        })
        return () => {
            active = false
        }
    }, [])

    useEffect(() => {
        if (!zstdReady || !desktopRuntimeInfo) return

        const socketAuth = buildRealtimeSocketAuth(appVersion, desktopRuntimeInfo)
        if (!socketRef.current) {
            const newSocket = createRealtimeSocket(socketAuth)
            socketRef.current = newSocket
            setSocket(newSocket)
            return
        }

        updateRealtimeSocketAuth(socketRef.current, socketAuth)
    }, [appVersion, desktopRuntimeInfo, zstdReady])

    useEffect(() => {
        const currentSocket = socketRef.current
        if (!currentSocket) return

        const resetSocketFailures = () => {
            unavailableToastShownRef.current = false
        }

        const notifyUnavailableIfNeeded = () => {
            connectionErrorAttemptsRef.current += 1
            if (connectionErrorAttemptsRef.current < CONNECTION_ERROR_TOAST_THRESHOLD) return
            if (unavailableToastShownRef.current) return

            unavailableToastShownRef.current = true
            toast.custom('error', t('common.somethingWrongTitle'), t('common.serverUnavailable'))
        }

        const onGatewayMessage = createGatewayHandler({
            t,
            zstdReady,
            zstdRef,
            setSocket,
            setSocketConnected,
            setUser,
            onLogout,
            onAchievementsUpdate,
            onAddonStoreUpdated,
            onNotificationCreated,
            onNotificationRead,
            onNotificationsReadAll,
            onPremiumUnlocked: () => openModal(Modals.PREMIUM_UNLOCKED),
            resetSocketFailures,
        })

        const onConnect = () => {
            resetSocketFailures()
            connectionErrorAttemptsRef.current = 0
            setSocket(currentSocket)
            setSocketConnected(true)
            toast.custom('success', t('common.connectionEstablished'))
        }

        const onConnectionLost = () => {
            if (!authExpiredRef.current) notifyUnavailableIfNeeded()
            authExpiredRef.current = false
            setSocket(null)
            setSocketConnected(false)
        }

        currentSocket.on(IncomingSocketEvents.CONNECT, onConnect)
        currentSocket.on(IncomingSocketEvents.DISCONNECT, onConnectionLost)
        currentSocket.on(IncomingSocketEvents.CONNECT_ERROR, onConnectionLost)
        currentSocket.on(IncomingSocketEvents.GATEWAY, onGatewayMessage)
        currentSocket.io.on(IncomingSocketEvents.RECONNECT, resetSocketFailures)

        return () => {
            resetSocketFailures()
            currentSocket.off(IncomingSocketEvents.CONNECT, onConnect)
            currentSocket.off(IncomingSocketEvents.DISCONNECT, onConnectionLost)
            currentSocket.off(IncomingSocketEvents.CONNECT_ERROR, onConnectionLost)
            currentSocket.off(IncomingSocketEvents.GATEWAY, onGatewayMessage)
            currentSocket.io.off(IncomingSocketEvents.RECONNECT, resetSocketFailures)
        }
    }, [
        onAchievementsUpdate,
        onAddonStoreUpdated,
        onLogout,
        onNotificationCreated,
        onNotificationRead,
        onNotificationsReadAll,
        Modals.PREMIUM_UNLOCKED,
        openModal,
        setUser,
        t,
        zstdReady,
        desktopRuntimeInfo,
    ])

    useEffect(() => {
        const currentSocket = socketRef.current
        if (!currentSocket || !zstdReady || !desktopRuntimeInfo || userId === '-1') return
        const stopReconnecting = reconnectOnAuthExpiry(currentSocket, () => {
            authExpiredRef.current = true
        })
        currentSocket.connect()
        return () => {
            stopReconnecting()
            currentSocket.disconnect()
        }
    }, [userId, zstdReady, desktopRuntimeInfo])

    const value = useMemo(
        () => ({
            socket,
            socketConnected,
            emitGateway,
        }),
        [emitGateway, socket, socketConnected],
    )

    return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}

export default SocketContext
