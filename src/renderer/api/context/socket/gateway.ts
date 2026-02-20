import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Socket } from 'socket.io-client'
import MainEvents from '@common/types/mainEvents'
import toast from '../../../components/toast'
import IncomingGatewayEvents from '../../socket/enums/incomingGatewayEvents'
import { parseGatewayFrame } from '../../socket/realtimeSocket'
import { applySubscriptionUpdate, applyUserUpdate, SubscriptionUpdatePayload, UserUpdatePayload } from '../../socket/realtimeUserEvents'
import type UserInterface from '../../interfaces/user.interface'
import { getGatewayErrorMessage } from './utils'
import RendererEvents from '@common/types/rendererEvents'
import { Modals } from '../modal/modals'

type CreateGatewayHandlerParams = {
    t: (key: string, options?: any) => string
    zstdReady: boolean
    zstdRef: MutableRefObject<any>
    setFeatures: Dispatch<SetStateAction<Record<string, boolean>>>
    setSocket: Dispatch<SetStateAction<Socket | null>>
    setSocketConnected: Dispatch<SetStateAction<boolean>>
    setUser: Dispatch<SetStateAction<UserInterface>>
    onLogout: () => Promise<void>
    resetSocketFailures: () => void
}

export function createGatewayHandler({
    t,
    zstdReady,
    zstdRef,
    setFeatures,
    setSocket,
    setSocketConnected,
    setUser,
    onLogout,
    resetSocketFailures,
}: CreateGatewayHandlerParams) {
    return async (buf: ArrayBuffer | Uint8Array) => {
        if (!zstdReady || !zstdRef.current) return

        const msg = parseGatewayFrame(buf, zstdRef.current)
        if (!msg?.e) return

        const gatewayEvent = msg.e
        const gatewayPayload = msg.d

        switch (gatewayEvent) {
            case IncomingGatewayEvents.FEATURE_TOGGLES:
                console.debug("Gateway feature toggles", gatewayPayload)
                setFeatures((gatewayPayload || {}) as Record<string, boolean>)
                break
            case IncomingGatewayEvents.DEPRECATED_VERSION:
                console.debug("Gateway deprecated version")
                toast.custom('error', t('common.attentionTitle'), t('auth.deprecatedSoon'))
                window.desktopEvents?.send(MainEvents.SHOW_NOTIFICATION, {
                    title: t('common.attentionTitle'),
                    body: t('auth.deprecatedSoon'),
                })
                break
            case IncomingGatewayEvents.UPDATE_FEATURES_ACK:
                break
            case IncomingGatewayEvents.ERROR_MESSAGE: {
                console.debug("Gateway error message", gatewayPayload)
                const message = getGatewayErrorMessage(gatewayPayload)
                if (message) {
                    toast.custom('error', t('common.errorTitleShort'), message, null, null, 15000)
                }
                break
            }
            case IncomingGatewayEvents.LOGOUT:
                console.debug("Gateway logout")
                setSocket(null)
                setSocketConnected(false)
                resetSocketFailures()
                await onLogout()
                break
            case IncomingGatewayEvents.USER_UPDATE:
                console.debug("Gateway user update", gatewayPayload)
                setUser(prev => applyUserUpdate(prev, gatewayPayload as UserUpdatePayload))
                break
            case IncomingGatewayEvents.SUBSCRIPTION_UPDATE:
                setUser(prev => applySubscriptionUpdate(prev, gatewayPayload as SubscriptionUpdatePayload))
                console.debug('Gateway subscription update', gatewayPayload)
                if (gatewayPayload?.hasSupporterBadge) {
                    window?.desktopEvents?.emit(RendererEvents.OPEN_MODAL, null, Modals.PREMIUM_UNLOCKED)
                }
                break
            default:
                break
        }
    }
}
