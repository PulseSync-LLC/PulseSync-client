import { getGatewayErrorMessage } from '@app/providers/socket/utils'
import IncomingGatewayEvents from '@shared/api/socket/enums/incomingGatewayEvents'
import { parseGatewayFrame } from '@shared/api/socket/realtimeSocket'
import { applySubscriptionUpdate, applyUserUpdate } from '@shared/api/socket/realtimeUserEvents'
import { desktopApi } from '@shared/desktop/desktopApi'
import toast from '@shared/ui/toast'

import type UserInterface from '@entities/user/model/user.interface'
import type { SubscriptionUpdatePayload, UserUpdatePayload } from '@shared/api/socket/realtimeUserEvents'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Socket } from 'socket.io-client'

type CreateGatewayHandlerParams = {
    t: (key: string, options?: any) => string
    zstdReady: boolean
    zstdRef: MutableRefObject<any>
    setSocket: Dispatch<SetStateAction<Socket | null>>
    setSocketConnected: Dispatch<SetStateAction<boolean>>
    setUser: Dispatch<SetStateAction<UserInterface>>
    onLogout: () => Promise<void>
    onAchievementsUpdate?: (payload: unknown) => Promise<void> | void
    onAddonStoreUpdated?: (payload: unknown) => Promise<void> | void
    onNotificationCreated?: (payload: unknown) => Promise<void> | void
    onNotificationRead?: (payload: unknown) => Promise<void> | void
    onNotificationsReadAll?: (payload: unknown) => Promise<void> | void
    onPremiumUnlocked?: () => void
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
    onAddonStoreUpdated,
    onNotificationCreated,
    onNotificationRead,
    onNotificationsReadAll,
    onPremiumUnlocked,
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
                desktopApi.system.showNotification({
                    title: t('common.attentionTitle'),
                    body: t('auth.deprecatedSoon'),
                })
                break
            case IncomingGatewayEvents.HARDWARE_IDENTITY_WARNING:
                console.debug('Gateway hardware identity warning', gatewayPayload)
                toast.custom('error', t('common.attentionTitle'), t('auth.hardwareIdentityWarning'), undefined, undefined, 15000)
                desktopApi.system.showNotification({
                    title: t('common.attentionTitle'),
                    body: t('auth.hardwareIdentityWarning'),
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
                    onPremiumUnlocked?.()
                }
                break
            case IncomingGatewayEvents.ACHIEVEMENTS_UPDATE:
                console.debug('Gateway achievements update', gatewayPayload)
                await onAchievementsUpdate?.(gatewayPayload)
                break
            case IncomingGatewayEvents.ADDON_STORE_UPDATED:
                console.debug('Gateway store addon update', gatewayPayload)
                await onAddonStoreUpdated?.(gatewayPayload)
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
