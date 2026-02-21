import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Socket } from 'socket.io-client'
import MainEvents from '@common/types/mainEvents'
import { useTranslation } from 'react-i18next'
import toast from '../../../components/toast'
import getUserToken from '../../getUserToken'
import { createRealtimeSocket, updateRealtimeSocketAuth } from '../../socket/realtimeSocket'
import IncomingSocketEvents from '../../socket/enums/incomingSocketEvents'
import type { OutgoingGatewayEvent } from '../../socket/enums/outgoingGatewayEvents'
import type { SocketContextValue, SocketProviderProps } from './types'
import { createGatewayHandler } from './gateway'
import {
    buildRealtimeSocketAuth,
    CONNECTION_ERROR_TOAST_THRESHOLD,
    emitCompressedGateway,
} from './utils'
import { useZstdCodec } from './useZstdCodec'

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
    setFeatures,
    setLoading,
    onLogout,
    onAchievementsUpdate,
    children,
}: SocketProviderProps) {
    const { t } = useTranslation()
    const [socket, setSocket] = useState<Socket | null>(null)
    const [socketConnected, setSocketConnected] = useState(false)
    const { zstdReady, zstdRef } = useZstdCodec()

    const socketRef = useRef<Socket | null>(null)
    const websocketStartedRef = useRef(false)
    const connectionErrorAttemptsRef = useRef(0)
    const unavailableToastShownRef = useRef(false)

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
        window.desktopEvents?.send(MainEvents.WEBSOCKET_START)
    }, [])

    useEffect(() => {
        if (!zstdReady) return

        const socketAuth = buildRealtimeSocketAuth(appVersion)

        if (!socketRef.current) {
            const newSocket = createRealtimeSocket(socketAuth)
            socketRef.current = newSocket
            setSocket(newSocket)
            return
        }

        updateRealtimeSocketAuth(socketRef.current, socketAuth)
    }, [appVersion, zstdReady])

    useEffect(() => {
        if (userId === '-1' || !socketRef.current) return

        const newToken = getUserToken()
        if (newToken && socketRef.current.auth) {
            const wasConnected = socketRef.current.connected
            socketRef.current.auth = {
                ...socketRef.current.auth,
                token: newToken,
            }

            if (wasConnected) {
                socketRef.current.disconnect()
                socketRef.current.connect()
            }
        }
    }, [userId])

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
            toast.custom('error', t('common.somethingWrongTitle'), t('common.serverUnavailableShort'))
        }

        const onGatewayMessage = createGatewayHandler({
            t,
            zstdReady,
            zstdRef,
            setFeatures,
            setSocket,
            setSocketConnected,
            setUser,
            onLogout,
            onAchievementsUpdate,
            resetSocketFailures,
        })

        const onConnect = () => {
            resetSocketFailures()
            connectionErrorAttemptsRef.current = 0
            setSocket(currentSocket)
            setSocketConnected(true)
            setLoading(false)
            toast.custom('success', t('common.connectionEstablished'))
        }

        const onConnectionLost = () => {
            notifyUnavailableIfNeeded()
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
    }, [onAchievementsUpdate, onLogout, setFeatures, setLoading, setUser, t, zstdReady])

    useEffect(() => {
        if (userId === '-1' || !zstdReady) return

        const currentSocket = socketRef.current
        if (!currentSocket) return

        currentSocket.auth = {
            ...(currentSocket.auth || {}),
            token: getUserToken(),
            compression: 'zstd-stream',
            inboundCompression: 'zstd-stream',
        }

        if (!currentSocket.connected) {
            currentSocket.connect()
        }
    }, [userId, zstdReady])

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
