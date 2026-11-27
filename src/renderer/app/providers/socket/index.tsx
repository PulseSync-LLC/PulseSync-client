import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useModalContext } from '@app/providers/modal'
import { createDecodedGatewayHandler } from '@app/providers/socket/gateway'
import { CONNECTION_ERROR_TOAST_THRESHOLD } from '@app/providers/socket/utils'
import { desktopApi } from '@shared/desktop/desktopApi'
import toast from '@shared/ui/toast'

import SocketContext from './context'

import type { SocketProviderProps } from './types'
import type { BackgroundConnection, BackgroundEvent } from '@common/background'
import type { OutgoingGatewayEvent } from '@shared/api/socket/enums/outgoingGatewayEvents'

export { useSocketContext } from './context'
export default SocketContext

const LegacySocketProvider = lazy(() => import('./LegacySocketProvider'))

export function SocketProvider(props: SocketProviderProps) {
    return desktopApi.background ? (
        <DesktopSocketProvider {...props} />
    ) : (
        <Suspense fallback={null}>
            <LegacySocketProvider {...props} />
        </Suspense>
    )
}

function DesktopSocketProvider(props: SocketProviderProps) {
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()
    const [socketConnected, setSocketConnected] = useState(false)
    const connected = useRef(false)
    const connectionRevision = useRef(-1)
    const unavailable = useRef(false)
    useEffect(() => {
        desktopApi.system.startWebsocket()
    }, [])
    const onEvent = useEffectEvent((event: BackgroundEvent, initial = false) => {
        const applyConnection = (connection: BackgroundConnection) => {
            if (connection.userId !== props.userId || connection.revision < connectionRevision.current) return
            connectionRevision.current = connection.revision
            if (connection.connected) {
                unavailable.current = false
                if (!initial && !connected.current) toast.custom('success', t('common.connectionEstablished'))
            } else if (connection.failures >= CONNECTION_ERROR_TOAST_THRESHOLD && !unavailable.current) {
                unavailable.current = true
                toast.custom('error', t('common.somethingWrongTitle'), t('common.serverUnavailable'))
            }
            connected.current = connection.connected
            setSocketConnected(connection.connected)
        }
        if (event.type === 'connection') applyConnection(event.connection)
        if (event.type === 'notice') toast.custom(event.tone, event.title, event.body)
        if (event.type === 'addons-changed') void props.onLocalAddonsChanged?.()
        if (event.type === 'gateway') {
            const handle = createDecodedGatewayHandler({
                ...props,
                t,
                setSocketConnected,
                onPremiumUnlocked: () => openModal(Modals.PREMIUM_UNLOCKED),
                resetSocketFailures: () => {
                    unavailable.current = false
                },
            })
            void handle(event.frame)
        }
    })

    useEffect(() => {
        const background = desktopApi.background!
        const unsubscribe = background.onChange(event => onEvent(event))
        if (props.userId === '-1') {
            connected.current = false
            setSocketConnected(false)
            return unsubscribe
        }
        let active = true
        void desktopApi
            .getRuntimeInfo()
            .then(runtime => {
                if (!active) return
                return background.start({
                    userId: props.userId,
                    version: props.appVersion.split('-')[0],
                    page: window.location.hash.replace(/^#/, ''),
                    buildIdentity: runtime.buildIdentity,
                    hardwareIdentity: runtime.hardwareIdentity,
                })
            })
            .then(connection => {
                if (active && connection) onEvent({ type: 'connection', connection }, true)
            })
            .catch(() => {
                if (active) setSocketConnected(false)
            })
        return () => {
            active = false
            unsubscribe()
        }
    }, [props.userId, props.appVersion])

    const emitGateway = useCallback((event: OutgoingGatewayEvent, payload: unknown) => desktopApi.background!.send(event, payload), [])
    const value = useMemo(() => ({ socketConnected, emitGateway }), [socketConnected, emitGateway])
    return <SocketContext.Provider value={value}>{props.children}</SocketContext.Provider>
}
