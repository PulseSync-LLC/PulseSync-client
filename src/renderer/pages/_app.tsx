import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createHashRouter, RouterProvider } from 'react-router'
import { useQuery } from '@apollo/client/react'
import { CombinedGraphQLErrors, ServerError } from '@apollo/client'
import UserMeQuery from '../api/queries/user/getMe.query'
import MainEvents from '../../common/types/mainEvents'
import RendererEvents from '../../common/types/rendererEvents'

import Dev from './dev'
import AuthPage from './auth'
import CallbackPage from './auth/callback'
import TrackInfoPage from './trackinfo'
import UsersPage from './users'
import ExtensionPage from './extension'
import JointPage from './joint'
import StorePage from './store'

import { Toaster } from 'react-hot-toast'
import { CssVarsProvider } from '@mui/joy'
import { io, Socket } from 'socket.io-client'
import UserInterface from '../api/interfaces/user.interface'
import userInitials from '../api/initials/user.initials'
import UserContext from '../api/context/user.context'
import toast from '../components/toast'
import { SkeletonTheme } from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'
import trackInitials from '../api/initials/track.initials'
import PlayerContext from '../api/context/player.context'
import apolloClient from '../api/apolloClient'
import client from '../api/apolloClient'
import SettingsInterface from '../api/interfaces/settings.interface'
import settingsInitials from '../api/initials/settings.initials'
import getUserToken from '../api/getUserToken'
import config from '@common/appConfig'
import { AppInfoInterface } from '../api/interfaces/appinfo.interface'

import Preloader from '../components/preloader'
import { fetchSettings } from '../api/settings'
import { areTracksEqual, checkInternetAccess, compareVersions, normalizeTrack, notifyUserRetries } from '../utils/utils'
import Addon from '../api/interfaces/addon.interface'
import AddonInitials from '../api/initials/addon.initials'
import { ModInterface } from '../api/interfaces/modInterface'
import modInitials from '../api/initials/mod.initials'
import GetModQuery from '../api/queries/getMod.query'
import { Track } from '../api/interfaces/track.interface'
import * as Sentry from '@sentry/electron/renderer'
import ErrorBoundary from '../components/errorBoundary/errorBoundary'
import { useDispatch } from 'react-redux'
import { setAppDeprecatedStatus } from '../api/store/appSlice'
import ProfilePage from './profile/[username]'
import { buildDiscordActivity } from '../utils/formatRpc'
import { useTranslation } from 'react-i18next'

type GetMeData = {
    getMe: Partial<UserInterface> | null
}
type GetMeVars = Record<string, never>

function App() {
    const { t } = useTranslation()
    const tRef = useRef(t)
    const [realtimeSocket, setRealtimeSocket] = useState<Socket | null>(null)
    const [connectionErrorCode, setConnectionErrorCode] = useState(-1)
    const [isConnected, setIsConnected] = useState(false)
    const [updateAvailable, setUpdate] = useState(false)
    const [user, setUser] = useState<UserInterface>(userInitials)
    const [app, setApp] = useState<SettingsInterface>(settingsInitials)
    const [modInfo, setMod] = useState<ModInterface[]>(modInitials)
    const [addons, setAddons] = useState<Addon[]>(AddonInitials)
    const [features, setFeatures] = useState<any>({})
    const [navigateTo, setNavigateTo] = useState<string | null>(null)
    const [navigateState, setNavigateState] = useState<Addon | null>(null)
    const [loading, setLoading] = useState(true)
    const [musicInstalled, setMusicInstalled] = useState(false)
    const [musicVersion, setMusicVersion] = useState<any>(null)
    const [modInfoFetched, setModInfoFetched] = useState(false)
    const [widgetInstalled, setWidgetInstalled] = useState(false)
    const toastReference = useRef<string | null>(null)
    const realtimeSocketRef = useRef<Socket | null>(null)
    const socketReconnectAttemptsRef = useRef(0)
    const socketReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const socketActivityClearedRef = useRef(false)
    const zstdRef = useRef<any>(null)
    const websocketStartedRef = useRef(false)
    const [zstdReady, setZstdReady] = useState(false)
    const connectionErrorAttemptsRef = useRef(0)
    const connectionErrorToastThreshold = 3

    const socketOfflineSinceRef = useRef<number | null>(null)
    const socketOfflineClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const socketOfflineClearAfterMs = 15000

    const [appInfo, setAppInfo] = useState<AppInfoInterface[]>([])
    const dispatch = useDispatch()

    const [tokenReady, setTokenReady] = useState(false)
    const [hasToken, setHasToken] = useState(false)
    const appRef = useRef(app)
    const rendererLoggingInitialized = useRef(false)

    useEffect(() => {
        tRef.current = t
    }, [t])

    useEffect(() => {
        if (rendererLoggingInitialized.current) return
        rendererLoggingInitialized.current = true
        if (typeof window === 'undefined') return

        const sendRendererError = (text: string) => {
            window.desktopEvents?.send(MainEvents.RENDERER_LOG, { error: true, text })
        }

        const formatLogValue = (value: any) => {
            if (value instanceof Error) {
                const stack = value.stack ? `\n${value.stack}` : ''
                return `${value.name}: ${value.message}${stack}`
            }
            if (typeof value === 'string') return value
            try {
                return JSON.stringify(value)
            } catch {
                return String(value)
            }
        }

        const formatLogArgs = (args: any[]) => args.map(formatLogValue).join(' ')

        const isIgnoredFetchUrl = (url: string) => {
            return url.startsWith('sentry-ipc://')
        }

        const originalConsoleError = console.error.bind(console)
        let isLoggingConsoleError = false
        console.error = (...args: any[]) => {
            if (!isLoggingConsoleError) {
                isLoggingConsoleError = true
                try {
                    sendRendererError(formatLogArgs(args))
                } catch (err) {
                    originalConsoleError('[Logger Error]', err)
                } finally {
                    isLoggingConsoleError = false
                }
            }
            originalConsoleError(...args)
        }

        const originalFetch = window.fetch?.bind(window)
        if (originalFetch) {
            window.fetch = (async (...args: Parameters<typeof fetch>) => {
                const [input] = args
                const url =
                    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : 'unknown'

                if (typeof url === 'string' && isIgnoredFetchUrl(url)) {
                    return originalFetch(...args)
                }

                try {
                    const response = await originalFetch(...args)
                    if (!response.ok) {
                        sendRendererError(`Fetch error: ${response.status} ${response.statusText} (${url})`)
                    }
                    return response
                } catch (error) {
                    sendRendererError(`Fetch exception: ${url} - ${formatLogValue(error)}`)
                    throw error
                }
            }) as typeof window.fetch
        }

        const onError = (event: ErrorEvent) => {
            const detail = event.error ? ` - ${formatLogValue(event.error)}` : ''
            sendRendererError(`Unhandled error: ${event.message}${detail}`)
        }
        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            sendRendererError(`Unhandled rejection: ${formatLogValue(event.reason)}`)
        }

        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onUnhandledRejection)

        return () => {
            console.error = originalConsoleError
            if (originalFetch) {
                window.fetch = originalFetch
            }
            window.removeEventListener('error', onError)
            window.removeEventListener('unhandledrejection', onUnhandledRejection)
        }
    }, [])

    useEffect(() => {
        appRef.current = app
    }, [app])

    useEffect(() => {
        let mounted = true
        const t = getUserToken()
        if (mounted) {
            setHasToken(!!t)
            setTokenReady(true)
        }
        return () => {
            mounted = false
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const mod = await import('zstd-codec')
                await new Promise<void>(resolve => {
                    ;(mod as any).ZstdCodec.run((z: any) => {
                        zstdRef.current = new z.Streaming()
                        if (!cancelled) setZstdReady(true)
                        resolve()
                    })
                })
            } catch {}
        })()
        return () => {
            cancelled = true
        }
    }, [])

    const {
        data: meData,
        loading: meLoading,
        error: meError,
        refetch: refetchMe,
    } = useQuery<GetMeData, GetMeVars>(UserMeQuery, {
        fetchPolicy: 'no-cache',
        skip: !tokenReady || !hasToken,
    })

    const router = useMemo(
        () =>
            createHashRouter([
                {
                    path: '/',
                    element: (
                        <ErrorBoundary>
                            <TrackInfoPage />
                        </ErrorBoundary>
                    ),
                },
                {
                    path: '/auth',
                    element: (
                        <ErrorBoundary>
                            <AuthPage />
                        </ErrorBoundary>
                    ),
                },
                {
                    path: '/dev',
                    element: (
                        <ErrorBoundary>
                            <Dev />
                        </ErrorBoundary>
                    ),
                },
                {
                    path: '/auth/callback',
                    element: (
                        <ErrorBoundary>
                            <CallbackPage />
                        </ErrorBoundary>
                    ),
                },
                {
                    path: '/users',
                    element: (
                        <ErrorBoundary>
                            <UsersPage />
                        </ErrorBoundary>
                    ),
                },
                {
                    path: '/extension',
                    element: (
                        <ErrorBoundary>
                            <ExtensionPage />
                        </ErrorBoundary>
                    ),
                },
                {
                    path: '/extension/:contactId',
                    element: (
                        <ErrorBoundary>
                            <ExtensionPage />
                        </ErrorBoundary>
                    ),
                },
                {
                    path: '/store',
                    element: (
                        <ErrorBoundary>
                            <StorePage />
                        </ErrorBoundary>
                    ),
                },
                {
                    path: '/joint',
                    element: (
                        <ErrorBoundary>
                            <JointPage />
                        </ErrorBoundary>
                    ),
                },
                {
                    path: '/profile/:username',
                    element: (
                        <ErrorBoundary>
                            <ProfilePage />
                        </ErrorBoundary>
                    ),
                },
            ]),
        [],
    )

    useEffect(() => {
        if (!meData || !tokenReady) return
        if (meData.getMe && meData.getMe.id) {
            setUser(prev => ({ ...prev, ...meData.getMe }) as UserInterface)
            ;(async () => {
                await router.navigate('/', { replace: true })
                window.desktopEvents?.send(MainEvents.AUTH_STATUS, {
                    status: true,
                    user: {
                        id: meData.getMe!.id as string,
                        username: meData.getMe!.username as string,
                        email: meData.getMe!.email as string,
                    },
                })
                setLoading(false)
            })()
        } else {
            setLoading(false)
            window.electron.store.delete('tokens.token')
            ;(async () => {
                await router.navigate('/auth', { replace: true })
            })()
            setUser(userInitials)
            toast.custom('error', tRef.current('common.errorTitle'), tRef.current('auth.failedToFetchUser'), null, null, 10000)
            window.desktopEvents?.send(MainEvents.AUTH_STATUS, {
                status: false,
            })
        }
    }, [meData, tokenReady, router])

    useEffect(() => {
        if (!meError) return
        const message = meError?.message || tRef.current('auth.unknownAuthError')
        if (CombinedGraphQLErrors.is(meError)) {
            const isDeprecated = meError.errors?.some((err: any) => err.extensions?.originalError?.error === 'DEPRECATED_VERSION')
            const isForbidden = meError.errors?.some((err: any) => err.extensions?.code === 'FORBIDDEN')
            if (isForbidden) {
                toast.custom('error', tRef.current('common.errorTitle'), tRef.current('auth.sessionExpired'), null, null, 10000)
                window.electron.store.delete('tokens.token')
                ;(async () => {
                    await router.navigate('/auth', { replace: true })
                })()
                setUser(userInitials)
                window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                setLoading(false)
                return
            }
            if (isDeprecated) {
                toast.custom(
                    'error',
                    tRef.current('auth.appVersionDeprecatedTitle'),
                    tRef.current('auth.appVersionDeprecatedMessage'),
                    null,
                    null,
                    10000,
                )
                window.desktopEvents?.send(MainEvents.UPDATER_START)
                dispatch(setAppDeprecatedStatus(true))
                window.electron.store.delete('tokens.token')
                ;(async () => {
                    await router.navigate('/auth', { replace: true })
                })()
                setUser(userInitials)
                window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                setLoading(false)
                return
            }
        }
        Sentry.captureException(meError)
        toast.custom('error', tRef.current('auth.accessQuestionTitle'), message)
        window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
        setLoading(false)
    }, [meError, dispatch])

    const authorize = useCallback(async () => {
        let retryCount = config.MAX_RETRY_COUNT

        const attemptAuthorization = async (): Promise<boolean> => {
            const token = getUserToken()

            if (token) {
                const isOnline = await checkInternetAccess()
                if (!isOnline) {
                    if (retryCount > 0) {
                        notifyUserRetries(retryCount)
                        retryCount--
                        return false
                    } else {
                        toast.custom('error', tRef.current('common.takeBreakTitle'), tRef.current('common.tooManyAttempts'))
                        window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                        setLoading(false)
                        return false
                    }
                }

                const sendErrorAuthNotify = (message: string, title?: string) => {
                    toast.custom('error', tRef.current('common.errorTitle'), message, null, null, 10000)
                    window.desktopEvents?.send(MainEvents.SHOW_NOTIFICATION, {
                        title: tRef.current('auth.authErrorTitle', { title }),
                        body: message,
                    })
                }

                try {
                    const res = await refetchMe()
                    const data = res.data as GetMeData | undefined

                    if (data?.getMe && data.getMe.id) {
                        setUser(prev => ({ ...prev, ...data.getMe }) as UserInterface)
                        await router.navigate('/', { replace: true })
                        window.desktopEvents?.send(MainEvents.AUTH_STATUS, {
                            status: true,
                            user: {
                                id: data.getMe.id as string,
                                username: data.getMe.username as string,
                                email: data.getMe.email as string,
                            },
                        })
                        return true
                    } else {
                        setLoading(false)
                        window.electron.store.delete('tokens.token')
                        await router.navigate('/auth', { replace: true })
                        setUser(userInitials)
                        sendErrorAuthNotify(tRef.current('auth.failedToFetchUser'))
                        window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                        return false
                    }
                } catch (e: unknown) {
                    const err = e as unknown

                    if ((ServerError as any)?.is?.(err) || (err as any)?.name === 'TypeError') {
                        if (retryCount > 0) {
                            notifyUserRetries(retryCount)
                            retryCount--
                            return false
                        } else {
                            toast.custom('error', tRef.current('common.pingPongTitle'), tRef.current('common.serverUnavailable'))
                            window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                            setLoading(false)
                            return false
                        }
                    } else if (CombinedGraphQLErrors.is(err)) {
                        const errors = (err as InstanceType<typeof CombinedGraphQLErrors>).errors || []
                        const isDeprecated = errors.some((error: any) => error.extensions?.originalError?.error === 'DEPRECATED_VERSION')
                        const isForbidden = errors.some((error: any) => error.extensions?.code === 'FORBIDDEN')
                        if (isForbidden) {
                            toast.custom('error', tRef.current('auth.sessionExpiredTitle'), tRef.current('auth.pleaseLoginAgain'))
                            window.electron.store.delete('tokens.token')
                            await router.navigate('/auth', { replace: true })
                            setUser(userInitials)
                            window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                            return false
                        } else if (isDeprecated) {
                            toast.custom(
                                'error',
                                tRef.current('auth.appVersionDeprecatedTitle'),
                                tRef.current('auth.appVersionDeprecatedMessage'),
                                null,
                                null,
                                10000,
                            )
                            window.desktopEvents?.send(MainEvents.UPDATER_START)
                            dispatch(setAppDeprecatedStatus(true))
                            window.electron.store.delete('tokens.token')
                            await router.navigate('/auth', { replace: true })
                            setUser(userInitials)
                            window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                            return false
                        } else {
                            Sentry.captureException(err)
                            toast.custom('error', tRef.current('auth.accessQuestionTitle'), tRef.current('auth.unknownAuthError'))
                            window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                            setLoading(false)
                            return false
                        }
                    } else {
                        Sentry.captureException(err)
                        toast.custom('error', tRef.current('auth.accessQuestionTitle'), tRef.current('auth.unknownAuthError'))
                        window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                        setLoading(false)
                        return false
                    }
                }
            } else {
                window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                setLoading(false)
                return false
            }
        }

        const retryAuthorization = async () => {
            let isAuthorized = await attemptAuthorization()

            if (!isAuthorized) {
                const retryInterval = setInterval(async () => {
                    const token = getUserToken()

                    if (!token) {
                        window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                        setLoading(false)
                        clearInterval(retryInterval)
                        return
                    }

                    isAuthorized = await attemptAuthorization()

                    if (isAuthorized || retryCount === 0) {
                        clearInterval(retryInterval)
                    }
                }, config.RETRY_INTERVAL_MS)
            }
        }

        window.desktopEvents?.invoke(MainEvents.CHECK_SLEEP_MODE).then(async (res: boolean) => {
            if (!res) {
                await retryAuthorization()
            }
        })
    }, [dispatch, refetchMe, router])

    const emitGateway = useCallback(
        (event: string, data: any) => {
            const s = realtimeSocketRef.current
            if (!s) return
            if (!zstdReady || !zstdRef.current || !s.connected) return
            try {
                const frame = new TextEncoder().encode(JSON.stringify({ e: event, d: data }))
                const compressed: Uint8Array = zstdRef.current.compress(frame, 3)
                s.emit('gw', compressed)
                return
            } catch {}
        },
        [zstdReady],
    )

    useEffect(() => {
        if (typeof window === 'undefined') return

        if (!websocketStartedRef.current) {
            websocketStartedRef.current = true
            window.desktopEvents?.send(MainEvents.WEBSOCKET_START)
        }

        return () => {}
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const checkAuthorization = async () => {
            await authorize()
        }

        if (user.id === '-1') {
            checkAuthorization()
        }

        const intervalId = setInterval(checkAuthorization, 10 * 60 * 1000)

        const handleMouseButton = (event: MouseEvent) => {
            const rawHash = window.location?.hash || ''
            const path = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
            const allowSideButtons = path.startsWith('/users') || path.startsWith('/profile')

            if (!allowSideButtons && (event.button === 3 || event.button === 4)) {
                event.preventDefault()
            }
        }

        const handleBeforeunload = (_event: BeforeUnloadEvent) => {
            window.desktopEvents?.send(MainEvents.DISCORDRPC_RESET_ACTIVITY)
        }

        const handleAuthStatus = async () => {
            await authorize()
        }

        window.desktopEvents?.on(RendererEvents.AUTH_SUCCESS, handleAuthStatus)
        window.addEventListener('mouseup', handleMouseButton)
        window.addEventListener('beforeunload', handleBeforeunload)

        return () => {
            clearInterval(intervalId)
            window.desktopEvents?.removeAllListeners(RendererEvents.AUTH_SUCCESS)
            window.removeEventListener('mouseup', handleMouseButton)
            window.removeEventListener('beforeunload', handleBeforeunload)
        }
    }, [authorize, user.id])

    useEffect(() => {
        if (!zstdReady) return
        const page = (() => {
            const rawHash = window.location?.hash || ''
            return rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
        })()
        const version = (app.info?.version || '0.0.0').split('-')[0]
        if (!realtimeSocketRef.current) {
            const socket = io(config.SOCKET_URL, {
                path: '/ws',
                autoConnect: false,
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 10000,
                auth: {
                    page,
                    token: getUserToken(),
                    version,
                    compression: 'zstd-stream',
                    inboundCompression: 'zstd-stream',
                },
                transports: ['websocket'],
            })
            realtimeSocketRef.current = socket
            setRealtimeSocket(socket)
        } else {
            const socket = realtimeSocketRef.current
            if (socket) {
                socket.auth = {
                    page,
                    token: getUserToken(),
                    version,
                    compression: 'zstd-stream',
                    inboundCompression: 'zstd-stream',
                }
            }
        }
    }, [app.info.version, zstdReady])

    useEffect(() => {
        if (user.id !== '-1' && realtimeSocketRef.current) {
            const newToken = getUserToken()
            if (newToken && realtimeSocketRef.current.auth) {
                const wasConnected = realtimeSocketRef.current.connected

                realtimeSocketRef.current.auth = {
                    ...realtimeSocketRef.current.auth,
                    token: newToken,
                }

                if (wasConnected) {
                    realtimeSocketRef.current.disconnect()
                    realtimeSocketRef.current.connect()
                }
            }
        }
    }, [user.id])

    useEffect(() => {
        const socket = realtimeSocketRef.current
        if (!socket) return

        const clearOfflineTimer = () => {
            if (socketOfflineClearTimerRef.current) {
                clearTimeout(socketOfflineClearTimerRef.current)
                socketOfflineClearTimerRef.current = null
            }
        }

        const resetSocketFailures = () => {
            socketReconnectAttemptsRef.current = 0
            socketActivityClearedRef.current = false
            if (socketReconnectTimerRef.current) {
                clearTimeout(socketReconnectTimerRef.current)
                socketReconnectTimerRef.current = null
            }

            socketOfflineSinceRef.current = null
            clearOfflineTimer()
        }

        const recordSocketFailure = (attempt?: number) => {
            socketReconnectAttemptsRef.current = Math.max(socketReconnectAttemptsRef.current, attempt ?? socketReconnectAttemptsRef.current + 1)
        }

        const scheduleReconnect = () => {
            if (socket.connected || socketReconnectTimerRef.current) return
            const delay = Math.min(1000 * Math.pow(2, Math.max(socketReconnectAttemptsRef.current - 1, 0)), 10000)
            socketReconnectTimerRef.current = setTimeout(() => {
                socketReconnectTimerRef.current = null
                if (!socket.connected) {
                    socket.connect()
                }
            }, delay)
        }

        const scheduleRpcClearIfOfflineTooLong = () => {
            if (socket.connected) return
            if (!socketOfflineSinceRef.current) socketOfflineSinceRef.current = Date.now()
            if (socketOfflineClearTimerRef.current) return

            socketOfflineClearTimerRef.current = setTimeout(() => {
                socketOfflineClearTimerRef.current = null
                if (!socket.connected && !socketActivityClearedRef.current) {
                    socketActivityClearedRef.current = true
                    if ((window as any)?.discordRpc?.clearActivity) {
                        ;(window as any).discordRpc.clearActivity()
                    }
                }
            }, socketOfflineClearAfterMs)
        }

        const onConnect = () => {
            resetSocketFailures()

            toast.custom('success', t('common.phewTitle'), t('common.connectionEstablished'))
            connectionErrorAttemptsRef.current = 0
            setRealtimeSocket(socket)
            setIsConnected(true)
            setConnectionErrorCode(-1)
            setLoading(false)
        }

        const onDisconnect = () => {
            connectionErrorAttemptsRef.current += 1
            if (connectionErrorAttemptsRef.current >= connectionErrorToastThreshold) {
                setConnectionErrorCode(1)
            }
            setRealtimeSocket(null)
            setIsConnected(false)

            scheduleRpcClearIfOfflineTooLong()
        }

        const onConnectError = (_err: any) => {
            connectionErrorAttemptsRef.current += 1
            if (connectionErrorAttemptsRef.current >= connectionErrorToastThreshold) {
                setConnectionErrorCode(1)
            }
            setRealtimeSocket(null)
            setIsConnected(false)

            scheduleRpcClearIfOfflineTooLong()
        }

        const onReconnectAttempt = (attempt: number) => {
            recordSocketFailure(attempt)
        }

        const onLogout = async () => {
            await client.clearStore()
            setUser(userInitials)
            setConnectionErrorCode(1)
            setRealtimeSocket(null)
            setIsConnected(false)
            resetSocketFailures()
            await router.navigate('/auth', { replace: true })
        }
        const onFeatures = (data: any) => {
            setFeatures(data)
        }
        const onDeprecated = () => {
            toast.custom('error', t('common.attentionTitle'), t('auth.deprecatedSoon'))
            window.desktopEvents?.send(MainEvents.SHOW_NOTIFICATION, {
                title: t('common.attentionTitle'),
                body: t('auth.deprecatedSoon'),
            })
        }

        const onGatewayMessage = (buf: ArrayBuffer | Uint8Array) => {
            if (!zstdReady || !zstdRef.current) return
            try {
                const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf instanceof Uint8Array ? buf : new Uint8Array(buf as any)
                const out: Uint8Array = zstdRef.current.decompress(u8)
                const msg = JSON.parse(new TextDecoder().decode(out))
                const e = msg?.e
                const d = msg?.d
                switch (e) {
                    case 'feature_toggles':
                        onFeatures(d)
                        break
                    case 'deprecated_version':
                        onDeprecated()
                        break
                    case 'update_features_ack':
                        break
                    case 'error_message':
                        if (d?.message) toast.custom('error', t('common.errorTitleShort'), d.message, null, null, 15000)
                        break
                    case 'logout':
                        onLogout()
                        break
                    default:
                        break
                }
            } catch {}
        }

        socket.on('connect', onConnect)
        socket.on('disconnect', onDisconnect)
        socket.on('connect_error', onConnectError)
        socket.on('gw', onGatewayMessage)
        socket.io.on('reconnect_attempt', onReconnectAttempt)
        socket.io.on('reconnect', resetSocketFailures)

        return () => {
            resetSocketFailures()
            socket.off('connect', onConnect)
            socket.off('disconnect', onDisconnect)
            socket.off('connect_error', onConnectError)
            socket.off('gw', onGatewayMessage)
            socket.io.off('reconnect_attempt', onReconnectAttempt)
            socket.io.off('reconnect', resetSocketFailures)
        }
    }, [router, zstdReady])

    useEffect(() => {
        if (connectionErrorCode === 1 || connectionErrorCode === 0) {
            toast.custom('error', t('common.somethingWrongTitle'), t('common.serverUnavailableShort'))
        } else if (isConnected && connectionErrorCode !== -1) {
            toast.custom('success', t('common.connectedTitle'), t('common.connectionRestored'))
        }
    }, [connectionErrorCode, isConnected])

    const fetchModInfo = useCallback(async (app: SettingsInterface) => {
        try {
            const res = await apolloClient.query<{ getMod: ModInterface[] }>({
                query: GetModQuery,
                fetchPolicy: 'no-cache',
            })

            const mods = res.data?.getMod
            if (!mods || mods.length === 0) {
                console.error('Invalid response format for getMod:', res.data)
                return
            }

            setMod(mods)

            const latest = mods[0]
            if (!app.mod.installed || !app.mod.version) {
                toast.custom('info', tRef.current('mod.notInstalledTitle'), tRef.current('mod.availableVersion', { version: latest.modVersion }))
                return
            }
            if (compareVersions(latest.modVersion, app.mod.version) > 0) {
                const lastNotifiedModVersion = localStorage.getItem('lastNotifiedModVersion')
                if (lastNotifiedModVersion !== latest.modVersion) {
                    window.desktopEvents?.send(MainEvents.SHOW_NOTIFICATION, {
                        title: tRef.current('mod.updateAvailableTitle'),
                        body: tRef.current('mod.updateAvailableBody', { version: latest.modVersion }),
                    })
                    localStorage.setItem('lastNotifiedModVersion', latest.modVersion)
                }
            } else {
                toast.custom('info', tRef.current('common.allGoodTitle'), tRef.current('mod.latestInstalled'))
            }
        } catch (e) {
            console.error('Failed to fetch mod info:', e)
        } finally {
            setModInfoFetched(true)
        }
    }, [])

    useEffect(() => {
        if (user.id === '-1') {
            setModInfoFetched(false)
        }
    }, [user.id])

    useEffect(() => {
        if (user.id !== '-1') {
            const initializeApp = async () => {
                if (!realtimeSocketRef.current?.connected && zstdReady) {
                    if (realtimeSocketRef.current) {
                        const s = realtimeSocketRef.current
                        s.auth = {
                            ...(s.auth || {}),
                            token: getUserToken(),
                            compression: 'zstd-stream',
                            inboundCompression: 'zstd-stream',
                        }
                    }
                    realtimeSocketRef.current?.connect()
                }

                window.desktopEvents?.send(MainEvents.UPDATER_START)
                window.desktopEvents?.send(MainEvents.CHECK_MUSIC_INSTALL)
                window.desktopEvents?.send(MainEvents.UI_READY)
                const [musicStatus, musicVersion, fetchedAddons] = await Promise.all([
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_STATUS),
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_VERSION),
                    window.desktopEvents?.invoke(MainEvents.GET_ADDONS),
                ])
                setMusicInstalled(musicStatus)
                setMusicVersion(musicVersion)
                setAddons(fetchedAddons)

                try {
                    const widgetExists = await window.desktopEvents?.invoke(MainEvents.CHECK_OBS_WIDGET_INSTALLED)
                    setWidgetInstalled(widgetExists || false)
                } catch (error) {
                    console.error('Failed to check widget installation:', error)
                    setWidgetInstalled(false)
                }

                try {
                    const res = await fetch(`${config.SERVER_URL}/api/v1/app/info`)
                    const data = await res.json()
                    if (data.ok && Array.isArray(data.appInfo)) {
                        const sortedAppInfos = data.appInfo.sort((a: any, b: any) => b.id - a.id)
                        setAppInfo(sortedAppInfos)
                    }
                } catch (error) {
                    console.error('Failed to fetch app info:', error)
                }

                await fetchModInfo(app)
            }

            initializeApp()

            const modCheckId = setInterval(() => fetchModInfo(app), 10 * 60 * 1000)

            return () => {
                clearInterval(modCheckId)
            }
        } else {
            router.navigate('/auth', { replace: true })
        }
    }, [fetchModInfo, router, user.id, zstdReady])

    const invokeFileEvent = useCallback(
        async (eventType: string, filePath: string, data?: any) => {
            return await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, eventType, filePath, data)
        },
        [t],
    )

    const handleOpenAddon = useCallback(
        (_event: any, data: string) => {
            window.desktopEvents
                ?.invoke(MainEvents.GET_ADDONS)
                .then((fetchedAddons: Addon[]) => {
                    const foundAddon = fetchedAddons.find(t => t.name === data)
                    if (foundAddon) {
                        if (!foundAddon.type || (foundAddon.type !== 'theme' && foundAddon.type !== 'script')) {
                            toast.custom('error', t('common.errorTitleShort'), t('addons.invalidType'), null, null, 15000)
                            return
                        }
                        setAddons(fetchedAddons)
                        setNavigateTo(`/extension/${encodeURIComponent(foundAddon.directoryName)}`)
                        setNavigateState(foundAddon)
                    }
                })
                .catch(error => console.error('Error getting themes:', error))
        },
        [setAddons, t],
    )

    useEffect(() => {
        window.desktopEvents?.on(RendererEvents.OPEN_ADDON, handleOpenAddon)
        window.desktopEvents?.on(RendererEvents.CHECK_FILE_EXISTS, (_event, filePath) => invokeFileEvent(RendererEvents.CHECK_FILE_EXISTS, filePath))
        window.desktopEvents?.on(RendererEvents.READ_FILE, (_event, filePath) => invokeFileEvent(RendererEvents.READ_FILE, filePath))
        window.desktopEvents?.on(RendererEvents.CREATE_CONFIG_FILE, (_event, filePath, defaultContent) =>
            invokeFileEvent(RendererEvents.CREATE_CONFIG_FILE, filePath, defaultContent),
        )
        window.desktopEvents?.on(RendererEvents.WRITE_FILE, (_event, filePath, data) => invokeFileEvent(RendererEvents.WRITE_FILE, filePath, data))

        return () => {
            window.desktopEvents?.removeAllListeners(RendererEvents.CREATE_CONFIG_FILE)
            window.desktopEvents?.removeAllListeners(RendererEvents.OPEN_ADDON)
            window.desktopEvents?.removeAllListeners(RendererEvents.CHECK_FILE_EXISTS)
            window.desktopEvents?.removeAllListeners(RendererEvents.READ_FILE)
            window.desktopEvents?.removeAllListeners(RendererEvents.WRITE_FILE)
        }
    }, [handleOpenAddon, invokeFileEvent])

    useEffect(() => {
        if (navigateTo && navigateState) {
            router.navigate(navigateTo, { state: { theme: navigateState } })
        }
    }, [navigateTo, navigateState, router])

    const onRpcLog = useCallback(
        (_: any, data: any) => {
            switch (data.type) {
                case 'error':
                    toast.custom('error', t('common.errorTitleShort'), t('rpc.message', { message: data.message }), null, null, 15000)
                    break
                case 'success':
                    toast.custom('success', t('common.successTitleShort'), t('rpc.message', { message: data.message }), null, null, 15000)
                    break
                case 'info':
                    toast.custom('info', t('common.infoTitleShort'), t('rpc.message', { message: data.message }))
                    break
                case 'warn':
                    toast.custom('warning', t('common.warningTitleShort'), t('rpc.message', { message: data.message }))
                    break
            }
        },
        [t],
    )

    useEffect(() => {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return
        if (!window.desktopEvents) return

        const handleRpcState = (_event: any, data: any) => {
            setApp(prevSettings => ({
                ...prevSettings,
                discordRpc: {
                    ...prevSettings.discordRpc,
                    status: data,
                },
            }))
        }

        const handleModUpdateCheck = async () => {
            await fetchModInfo(appRef.current)
        }

        const handleClientReady = () => {
            window.desktopEvents?.send(MainEvents.REFRESH_MOD_INFO)
            window.desktopEvents?.send(MainEvents.GET_TRACK_INFO)
        }

        const handleCheckUpdate = (_event: any, data: any) => {
            if (!toastReference.current) {
                toastReference.current = toast.custom('loading', t('updates.checkingTitle'), t('common.pleaseWait'))
            }
            if (!data.updateAvailable) {
                toast.update(toastReference.current!, {
                    kind: 'info',
                    title: t('updates.notFoundTitle'),
                    msg: t('updates.notFoundMessage'),
                    sticky: false,
                    duration: 5000,
                })
                toastReference.current = null
            }
        }

        const onDownloadProgress = (_e: any, value: number) => {
            toast.update(toastReference.current!, {
                kind: 'loading',
                title: t('updates.downloadingTitle'),
                msg: (
                    <>
                        {t('updates.downloadingLabel')}&nbsp;
                        <b>{Math.floor(value)}%</b>
                    </>
                ),
                value,
            })
        }

        const onDownloadFailed = () => {
            toast.update(toastReference.current!, {
                kind: 'error',
                title: t('common.errorTitle'),
                msg: t('updates.downloadError'),
                sticky: false,
            })
            toastReference.current = null
        }

        const onDownloadFinished = () => {
            toast.update(toastReference.current!, {
                kind: 'success',
                title: t('common.successTitle'),
                msg: t('updates.downloaded'),
                sticky: false,
                duration: 5000,
            })
            toastReference.current = null
            setUpdate(true)
        }

        const handleUpdateAvailable = () => {
            setUpdate(true)
        }

        window.desktopEvents?.on(RendererEvents.DISCORD_RPC_STATE, handleRpcState)
        window.desktopEvents?.on(RendererEvents.CHECK_MOD_UPDATE, handleModUpdateCheck)
        window.desktopEvents?.on(RendererEvents.CLIENT_READY, handleClientReady)
        window.desktopEvents?.on(RendererEvents.RPC_LOG, onRpcLog)

        window.desktopEvents?.invoke(MainEvents.GET_VERSION).then((version: string) => {
            setApp(prevSettings => ({
                ...prevSettings,
                info: {
                    ...prevSettings.info,
                    version: version,
                },
            }))
        })

        window.desktopEvents?.on(RendererEvents.CHECK_UPDATE, handleCheckUpdate)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, onDownloadProgress)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_FAILED, onDownloadFailed)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_FINISHED, onDownloadFinished)
        window.desktopEvents?.on(RendererEvents.UPDATE_AVAILABLE, handleUpdateAvailable)

        const loadSettings = async () => {
            await fetchSettings(setApp)
        }
        loadSettings()

        return () => {
            const cleanupEvents = [
                RendererEvents.RPC_LOG,
                RendererEvents.DISCORD_RPC_STATE,
                RendererEvents.CHECK_MOD_UPDATE,
                RendererEvents.CLIENT_READY,
                RendererEvents.DOWNLOAD_UPDATE_PROGRESS,
                RendererEvents.DOWNLOAD_UPDATE_FAILED,
                RendererEvents.DOWNLOAD_UPDATE_FINISHED,
                RendererEvents.CHECK_UPDATE,
                RendererEvents.UPDATE_AVAILABLE,
            ]

            cleanupEvents.forEach(event => {
                window.desktopEvents?.removeAllListeners(event)
            })
        }
    }, [fetchModInfo, onRpcLog])

    const setAppWithSocket = useCallback(
        (updater: (prev: SettingsInterface) => SettingsInterface) => {
            setApp(prevSettings => {
                const updatedSettings = typeof updater === 'function' ? updater(prevSettings) : updater

                if (realtimeSocketRef.current && realtimeSocketRef.current.connected) {
                    const socketInfo = { ...updatedSettings }
                    delete (socketInfo as any).tokens
                    delete (socketInfo as any).info
                    emitGateway('user_settings_update', socketInfo)
                }

                return updatedSettings
            })
        },
        [emitGateway],
    )

    useEffect(() => {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return
        ;(window as any).setToken = async (args: any) => {
            window.electron.store.set('tokens.token', args)
            setHasToken(true)
            setTokenReady(true)
            await authorize()
        }
        ;(window as any).refreshAddons = async (_args: any) => {
            window.desktopEvents.invoke(MainEvents.GET_ADDONS).then((fetchedAddons: Addon[]) => {
                setAddons(fetchedAddons)
                router.navigate('/extension', { replace: true })
            })
        }
        ;(window as any).getModInfo = async (currentApp: SettingsInterface) => {
            await fetchModInfo(currentApp)
        }
    }, [authorize, fetchModInfo, router])

    return (
        <div className="app-wrapper">
            <Toaster position="top-center" reverseOrder={false} />
            <UserContext.Provider
                value={
                    {
                        user,
                        setUser,
                        authorize,
                        loading: loading || meLoading,
                        musicInstalled,
                        setMusicInstalled,
                        musicVersion,
                        setMusicVersion,
                        widgetInstalled,
                        setWidgetInstalled,
                        socket: realtimeSocket,
                        socketConnected: isConnected,
                        app,
                        setApp: setAppWithSocket,
                        updateAvailable,
                        setUpdate,
                        appInfo,
                        setAddons,
                        addons,
                        setMod: setMod,
                        modInfo: modInfo,
                        modInfoFetched,
                        features,
                        setFeatures,
                        emitGateway,
                        emitGw: emitGateway,
                    } as any
                }
            >
                <Player>
                    <SkeletonTheme baseColor="#1c1c22" highlightColor="#333">
                        <CssVarsProvider>{loading || meLoading ? <Preloader /> : <RouterProvider router={router} />}</CssVarsProvider>
                    </SkeletonTheme>
                </Player>
            </UserContext.Provider>
        </div>
    )
}

const Player: React.FC<any> = ({ children }) => {
    const userCtx = useContext(UserContext) as any
    const { user, app, socket, features } = userCtx
    const emitGateway: (e: string, d: any) => void = userCtx.emitGateway || userCtx.emitGw
    const [track, setTrack] = useState<Track>(trackInitials)
    const lastSentTrack = useRef({ title: null as string | null, status: null as string | null, progressPlayed: null as number | null })
    const lastSendAt = useRef(0)

    const lastValidActivityRef = useRef<ReturnType<typeof buildDiscordActivity>>(null)
    const lastValidActivityAtRef = useRef(0)

    const rpcClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const rpcStatusLostAtRef = useRef<number | null>(null)
    const rpcClearDebounceMs = 10000 // 10s

    const holdLastActivityMs = 30000 // 30s

    const refreshGraceMs = 15000

    const handleSendTrackPlayedEnough = useCallback(
        (_e: any, data: any) => {
            if (!data) return
            if (socket && socket.connected) {
                emitGateway('track_played_enough', { track: { id: data.realId } })
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
        if (user.id === '-1') {
            if ((window as any)?.discordRpc?.clearActivity) {
                ;(window as any).discordRpc.clearActivity()
            }
            return
        }
        if (typeof window === 'undefined' || !(window as any).desktopEvents) return

        const de = (window as any).desktopEvents
        de.on(RendererEvents.SEND_TRACK, handleSendTrackPlayedEnough)
        de.on(RendererEvents.TRACK_INFO, handleTrackInfo)

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
        if (user.id === '-1') return

        const rpcEnabled = !!app?.discordRpc?.status

        if (rpcEnabled) {
            rpcStatusLostAtRef.current = null
            if (rpcClearTimerRef.current) {
                clearTimeout(rpcClearTimerRef.current)
                rpcClearTimerRef.current = null
            }
            return
        }

        if (!rpcStatusLostAtRef.current) {
            rpcStatusLostAtRef.current = Date.now()
        }
        if (!rpcClearTimerRef.current) {
            rpcClearTimerRef.current = setTimeout(() => {
                rpcClearTimerRef.current = null
                if (!app?.discordRpc?.status && (window as any)?.discordRpc?.clearActivity) {
                    ;(window as any).discordRpc.clearActivity()
                }
            }, rpcClearDebounceMs)
        }

        return () => {
            if (rpcClearTimerRef.current) {
                clearTimeout(rpcClearTimerRef.current)
                rpcClearTimerRef.current = null
            }
        }
    }, [app?.discordRpc?.status, user.id])

    useEffect(() => {
        if (user.id === '-1') {
            if ((window as any)?.discordRpc?.clearActivity) {
                ;(window as any).discordRpc.clearActivity()
            }
            return
        }

        if (!app.discordRpc.status) {
            return
        }

        const activity = buildDiscordActivity(track, app, user)

        if (!activity) {
            if (track.status === 'paused' && !app.discordRpc.displayPause) {
                if ((window as any)?.discordRpc?.clearActivity) {
                    ;(window as any).discordRpc.clearActivity()
                }
                lastValidActivityRef.current = null
                lastValidActivityAtRef.current = 0
                return
            }
            const isRefreshTrack = track.realId === trackInitials.realId
            const now = Date.now()

            if (isRefreshTrack && lastValidActivityRef.current && now - lastValidActivityAtRef.current < refreshGraceMs) {
                return
            }

            if (lastValidActivityRef.current && now - lastValidActivityAtRef.current < holdLastActivityMs) {
                return
            }

            if ((window as any)?.discordRpc?.clearActivity) {
                ;(window as any).discordRpc.clearActivity()
            }
            return
        }

        lastValidActivityRef.current = activity
        lastValidActivityAtRef.current = Date.now()
        if ((window as any)?.discordRpc?.setActivity) {
            ;(window as any).discordRpc.setActivity(activity)
        }
    }, [app, user.id, track, user])

    useEffect(() => {
        if (!socket || !features.sendTrack) return
        const { title, status, sourceType, progress } = track

        const progressPlayed = progress?.position
        if (!title || sourceType === 'ynison' || !['playing', 'paused'].includes(status)) return

        const now = Date.now()
        if (now - lastSendAt.current < 1000) return

        const last = lastSentTrack.current
        if (last.title === title && last.status === status && last.progressPlayed === progressPlayed) return

        emitGateway('send_track', track)

        lastSentTrack.current = { title, status, progressPlayed }
        lastSendAt.current = now
    }, [socket, track, features.sendTrack, emitGateway])

    useEffect(() => {
        if (!socket) return

        const send = () => {
            if (!features.sendMetrics) return
            const enabledTheme = (window as any)?.electron?.store?.get('addons.theme')
            const enabledScripts = (window as any)?.electron?.store?.get('addons.scripts')
            emitGateway('send_metrics', { theme: enabledTheme || 'Default', scripts: enabledScripts || [] })
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

export default App

