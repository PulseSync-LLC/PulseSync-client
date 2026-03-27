import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Socket } from 'socket.io-client'
import MainEvents from '@common/types/mainEvents'
import toast from '@shared/ui/toast'
import IncomingGatewayEvents from '@shared/api/socket/enums/incomingGatewayEvents'
import { parseGatewayFrame } from '@shared/api/socket/realtimeSocket'
import { applySubscriptionUpdate, applyUserUpdate, SubscriptionUpdatePayload, UserUpdatePayload } from '@shared/api/socket/realtimeUserEvents'
import type UserInterface from '@entities/user/model/user.interface'
import { getGatewayErrorMessage } from '@app/providers/socket/utils'
import RendererEvents from '@common/types/rendererEvents'
import { Modals } from '@app/providers/modal/modals'

type CreateGatewayHandlerParams = {
    t: (key: string, options?: any) => string
    zstdReady: boolean
    zstdRef: MutableRefObject<any>
    setSocket: Dispatch<SetStateAction<Socket | null>>
    setSocketConnected: Dispatch<SetStateAction<boolean>>
    setUser: Dispatch<SetStateAction<UserInterface>>
    onLogout: () => Promise<void>
    onAchievementsUpdate?: (payload: unknown) => Promise<void> | void
    onNotificationCreated?: (payload: unknown) => Promise<void> | void
    onNotificationRead?: (payload: unknown) => Promise<void> | void
    onNotificationsReadAll?: (payload: unknown) => Promise<void> | void
    resetSocketFailures: () => void
}

export function createGatewayHandler({
    t,
    zstdReady,
    zstdRef,
    setSocket,
    setSocketConnected,
    setUser,
    onLogout,
    onAchievementsUpdate,
    onNotificationCreated,
    onNotificationRead,
    onNotificationsReadAll,
    resetSocketFailures,
}: CreateGatewayHandlerParams) {
    return async (buf: ArrayBuffer | Uint8Array) => {
        if (!zstdReady || !zstdRef.current) return

        const msg = parseGatewayFrame(buf, zstdRef.current)
        if (!msg?.e) return

        const gatewayEvent = msg.e
        const gatewayPayload = msg.d

        switch (gatewayEvent) {
            case IncomingGatewayEvents.DEPRECATED_VERSION:
                console.debug('Gateway deprecated version')
                toast.custom('error', t('common.attentionTitle'), t('auth.deprecatedSoon'))
                window.desktopEvents?.send(MainEvents.SHOW_NOTIFICATION, {
                    title: t('common.attentionTitle'),
                    body: t('auth.deprecatedSoon'),
                })
                break
            case IncomingGatewayEvents.ERROR_MESSAGE: {
                console.debug('Gateway error message', gatewayPayload)
                const message = getGatewayErrorMessage(gatewayPayload)
                if (message) {
                    toast.custom('error', t('common.errorTitleShort'), message, undefined, undefined, 15000)
                }
                break
            }
            case IncomingGatewayEvents.LOGOUT:
                console.debug('Gateway logout')
                setSocket(null)
                setSocketConnected(false)
                resetSocketFailures()
                await onLogout()
                break
            case IncomingGatewayEvents.USER_UPDATE:
                console.debug('Gateway user update', gatewayPayload)
                setUser(prev => applyUserUpdate(prev, gatewayPayload as UserUpdatePayload))
                break
            case IncomingGatewayEvents.SUBSCRIPTION_UPDATE:
                setUser(prev => applySubscriptionUpdate(prev, gatewayPayload as SubscriptionUpdatePayload))
                console.debug('Gateway subscription update', gatewayPayload)
                if (gatewayPayload?.hasSupporterBadge) {
                    window?.desktopEvents?.emit(RendererEvents.OPEN_MODAL, null, Modals.PREMIUM_UNLOCKED)
                }
                break
            case IncomingGatewayEvents.ACHIEVEMENTS_UPDATE:
                console.debug('Gateway achievements update', gatewayPayload)
                await onAchievementsUpdate?.(gatewayPayload)
                break
            case IncomingGatewayEvents.NOTIFICATION_CREATED:
                console.debug('Gateway notification created', gatewayPayload)
                await onNotificationCreated?.(gatewayPayload)
                break
            case IncomingGatewayEvents.NOTIFICATION_READ:
                console.debug('Gateway notification read', gatewayPayload)
                await onNotificationRead?.(gatewayPayload)
                break
            case IncomingGatewayEvents.NOTIFICATIONS_READ_ALL:
                console.debug('Gateway notifications read all', gatewayPayload)
                await onNotificationsReadAll?.(gatewayPayload)
                break
            default:
                break
        }
    }
}
