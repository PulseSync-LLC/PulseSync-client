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

import { Toaster } from 'react-hot-toast'
import { CssVarsProvider } from '@mui/joy'
import { Socket } from 'socket.io-client'
import UserInterface from '../api/interfaces/user.interface'
import userInitials from '../api/initials/user.initials'
import { io } from 'socket.io-client'
import UserContext from '../api/context/user.context'
import toast from '../components/toast'
import { SkeletonTheme } from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'
import trackInitials from '../api/initials/track.initials'
import PlayerContext from '../api/context/player.context'
import apolloClient from '../api/apolloClient'
import SettingsInterface from '../api/interfaces/settings.interface'
import settingsInitials from '../api/initials/settings.initials'
import getUserToken from '../api/getUserToken'
import config from '../api/config'
import { AppInfoInterface } from '../api/interfaces/appinfo.interface'

import Preloader from '../components/preloader'
import { fetchSettings } from '../api/settings'
import { checkInternetAccess, compareVersions, notifyUserRetries, normalizeTrack, areTracksEqual } from '../utils/utils'
import Addon from '../api/interfaces/addon.interface'
import AddonInitials from '../api/initials/addon.initials'
import { ModInterface } from '../api/interfaces/modInterface'
import modInitials from '../api/initials/mod.initials'
import GetModQuery from '../api/queries/getMod.query'
import { Track } from '../api/interfaces/track.interface'
import * as Sentry from '@sentry/electron/renderer'
import client from '../api/apolloClient'
import ErrorBoundary from '../components/errorBoundary/errorBoundary'
import { useDispatch } from 'react-redux'
import { setAppDeprecatedStatus } from '../api/store/appSlice'
import ProfilePage from './profile/[username]'
import { buildDiscordActivity } from '../utils/formatRpc'

type GetMeData = {
    getMe: Partial<UserInterface> | null
}
type GetMeVars = Record<string, never>

function App() {
    const [socketIo, setSocket] = useState<Socket | null>(null)
    const [socketError, setSocketError] = useState(-1)
    const [socketConnected, setSocketConnected] = useState(false)
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
    const toastReference = useRef<string | null>(null)
    const socketRef = useRef<Socket | null>(null)

    const [appInfo, setAppInfo] = useState<AppInfoInterface[]>([])
    const dispatch = useDispatch()

    const [tokenReady, setTokenReady] = useState(false)
    const [hasToken, setHasToken] = useState(false)

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

    const {
        data: meData,
        loading: meLoading,
        error: meError,
        refetch: refetchMe,
    } = useQuery<GetMeData, GetMeVars>(UserMeQuery, {
        fetchPolicy: 'no-cache',
        skip: !tokenReady || !hasToken,
    })

    useEffect(() => {
        if (!meData || !tokenReady) return
        if (meData.getMe && meData.getMe.id) {
            setUser(prev => ({ ...prev, ...meData.getMe }) as UserInterface)
            ;(async () => {
                await router.navigate('/trackinfo', { replace: true })
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
                await router.navigate('/', { replace: true })
            })()
            setUser(userInitials)
            toast.custom('error', 'Ошибка', 'Не удалось получить данные пользователя. Пожалуйста, войдите снова.', null, null, 10000)
            window.desktopEvents?.send(MainEvents.AUTH_STATUS, {
                status: false,
            })
        }
    }, [meData, tokenReady])

    useEffect(() => {
        if (!meError) return
        const message = meError?.message || 'Неизвестная ошибка авторизации.'
        if (CombinedGraphQLErrors.is(meError)) {
            const isDeprecated = meError.errors?.some((err: any) => err.extensions?.originalError?.error === 'DEPRECATED_VERSION')
            const isForbidden = meError.errors?.some((err: any) => err.extensions?.code === 'FORBIDDEN')
            if (isForbidden) {
                toast.custom('error', 'Ошибка', 'Ваша сессия истекла. Пожалуйста, войдите снова.', null, null, 10000)
                window.electron.store.delete('tokens.token')
                ;(async () => {
                    await router.navigate('/', { replace: true })
                })()
                setUser(userInitials)
                window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                setLoading(false)
                return
            }
            if (isDeprecated) {
                toast.custom(
                    'error',
                    'Данная версия приложения устарела',
                    'Ошибка авторизации. Данная версия приложения устарела. Скачивание новой версии начнется автоматически.',
                    null,
                    null,
                    10000,
                )
                window.desktopEvents?.send(MainEvents.UPDATER_START)
                dispatch(setAppDeprecatedStatus(true))
                window.electron.store.delete('tokens.token')
                ;(async () => {
                    await router.navigate('/', { replace: true })
                })()
                setUser(userInitials)
                window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                setLoading(false)
                return
            }
        }
        Sentry.captureException(meError)
        toast.custom('error', 'Может у тебя нет доступа?', message)
        window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
        setLoading(false)
    }, [meError, dispatch])

    const router = useMemo(
        () =>
            createHashRouter([
                {
                    path: '/',
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
                    path: '/trackinfo',
                    element: (
                        <ErrorBoundary>
                            <TrackInfoPage />
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

    const authorize = async () => {
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
                        toast.custom('error', 'Отдохни чуток:)', 'Превышено количество попыток подключения.')
                        window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                        setLoading(false)
                        return false
                    }
                }

                const sendErrorAuthNotify = (message: string, title?: string) => {
                    toast.custom('error', 'Ошибка', message, null, null, 10000)
                    window.desktopEvents?.send(MainEvents.SHOW_NOTIFICATION, {
                        title: `Ошибка авторизации 😡 ${title ? title : ''}`,
                        body: message,
                    })
                }

                try {
                    const res = await refetchMe()
                    const data = res.data as GetMeData | undefined

                    if (data?.getMe && data.getMe.id) {
                        setUser(prev => ({ ...prev, ...data.getMe }) as UserInterface)
                        await router.navigate('/trackinfo', { replace: true })
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
                        await router.navigate('/', { replace: true })
                        setUser(userInitials)
                        sendErrorAuthNotify('Не удалось получить данные пользователя. Пожалуйста, войдите снова.')
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
                            toast.custom('error', 'Пинг-понг', 'Сервер недоступен. Попробуйте позже.')
                            window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                            setLoading(false)
                            return false
                        }
                    } else if (CombinedGraphQLErrors.is(err)) {
                        const errors = (err as InstanceType<typeof CombinedGraphQLErrors>).errors || []
                        const isDeprecated = errors.some((error: any) => error.extensions?.originalError?.error === 'DEPRECATED_VERSION')
                        const isForbidden = errors.some((error: any) => error.extensions?.code === 'FORBIDDEN')
                        if (isForbidden) {
                            toast.custom('error', 'Ваша сессия истекла', 'Пожалуйста, войдите снова.')
                            window.electron.store.delete('tokens.token')
                            await router.navigate('/', { replace: true })
                            setUser(userInitials)
                            window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                            return false
                        } else if (isDeprecated) {
                            toast.custom(
                                'error',
                                'Данная версия приложения устарела',
                                'Ошибка авторизации. Данная версия приложения устарела. Скачивание новой версии начнется автоматически.',
                                null,
                                null,
                                10000,
                            )
                            window.desktopEvents?.send(MainEvents.UPDATER_START)
                            dispatch(setAppDeprecatedStatus(true))
                            window.electron.store.delete('tokens.token')
                            await router.navigate('/', { replace: true })
                            setUser(userInitials)
                            window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                            return false
                        } else {
                            Sentry.captureException(err)
                            toast.custom('error', 'Может у тебя нет доступа?', 'Неизвестная ошибка авторизации.')
                            window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
                            setLoading(false)
                            return false
                        }
                    } else {
                        Sentry.captureException(err)
                        toast.custom('error', 'Может у тебя нет доступа?', 'Неизвестная ошибка авторизации.')
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
    }

    useEffect(() => {
        if (typeof window !== 'undefined') {
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

            const handleAuthStatus = async (_event: any) => {
                await authorize()
            }

            window.desktopEvents?.send(MainEvents.WEBSOCKET_START)
            window.desktopEvents?.on(RendererEvents.AUTH_SUCCESS, handleAuthStatus)
            window.addEventListener('mouseup', handleMouseButton)
            window.addEventListener('beforeunload', handleBeforeunload)

            return () => {
                clearInterval(intervalId)
                window.desktopEvents?.removeAllListeners(RendererEvents.AUTH_SUCCESS)
                window.removeEventListener('mouseup', handleMouseButton)
                window.removeEventListener('beforeunload', handleBeforeunload)
            }
        }
    }, [])

    useEffect(() => {
        const page = (() => {
            const rawHash = window.location?.hash || ''
            return rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
        })()
        const version = (app.info?.version || '0.0.0').split('-')[0]
        if (!socketRef.current) {
            const socket = io(config.SOCKET_URL, {
                path: '/ws',
                autoConnect: false,
                auth: {
                    page,
                    token: getUserToken(),
                    version,
                },
            })
            socketRef.current = socket
            setSocket(socket)
        } else {
            const socket = socketRef.current
            if (socket) {
                socket.auth = { page, token: getUserToken(), version }
            }
        }
    }, [app.info.version])

    useEffect(() => {
        const socket = socketRef.current
        if (!socket) return

        const onConnect = () => {
            toast.custom('success', 'Фух', 'Соединение установлено')
            socket.emit('connection')
            setSocket(socket)
            setSocketConnected(true)
            setSocketError(-1)
            setLoading(false)
        }
        const onDisconnect = () => {
            setSocketError(1)
            setSocket(null)
            setSocketConnected(false)
        }
        const onConnectError = (_err: any) => {
            setSocketError(1)
            setSocket(null)
            setSocketConnected(false)
        }
        const onLogout = async () => {
            await client.resetStore()
            setUser(userInitials)
            setSocketError(1)
            setSocket(null)
            setSocketConnected(false)
            await router.navigate('/', { replace: true })
        }
        const onFeatures = (data: any) => {
            setFeatures(data)
        }
        const onDeprecated = () => {
            toast.custom('error', 'Внимание!', 'Ваша версия приложения устарела 🤠 и скоро прекратит работу. Пожалуйста, обновите приложение.')
            window.desktopEvents?.send(MainEvents.SHOW_NOTIFICATION, {
                title: 'Внимание!',
                body: 'Ваша версия приложения устарела 🤠 и скоро прекратит работу. Пожалуйста, обновите приложение.',
            })
        }

        socket.on('connect', onConnect)
        socket.on('disconnect', onDisconnect)
        socket.on('connect_error', onConnectError)
        socket.on('logout', onLogout)
        socket.on('feature_toggles', onFeatures)
        socket.on('deprecated_version', onDeprecated)

        return () => {
            socket.off('connect', onConnect)
            socket.off('disconnect', onDisconnect)
            socket.off('connect_error', onConnectError)
            socket.off('logout', onLogout)
            socket.off('feature_toggles', onFeatures)
            socket.off('deprecated_version', onDeprecated)
        }
    }, [router])

    useEffect(() => {
        if (socketError === 1 || socketError === 0) {
            toast.custom('error', 'Что-то не так!', 'Сервер не доступен')
        } else if (socketConnected && socketError !== -1) {
            toast.custom('success', 'На связи', 'Соединение восстановлено')
        }
    }, [socketError, socketConnected])

    const fetchModInfo = async (app: SettingsInterface) => {
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
                toast.custom('info', 'Мод не установлен', `Доступна установка версии ${latest.modVersion}`)
                return
            }
            if (compareVersions(latest.modVersion, app.mod.version) > 0) {
                const lastNotifiedModVersion = localStorage.getItem('lastNotifiedModVersion')
                if (lastNotifiedModVersion !== latest.modVersion) {
                    window.desktopEvents?.send(MainEvents.SHOW_NOTIFICATION, {
                        title: 'Доступно обновление мода',
                        body: `Версия ${latest.modVersion} доступна для установки.`,
                    })
                    localStorage.setItem('lastNotifiedModVersion', latest.modVersion)
                }
            } else {
                toast.custom('info', 'Всё в порядке', 'У вас установлена последняя версия мода')
            }
        } catch (e) {
            console.error('Failed to fetch mod info:', e)
        }
    }

    useEffect(() => {
        if (user.id !== '-1') {
            const initializeApp = async () => {
                if (!socketRef.current?.connected) {
                    socketRef.current?.connect()
                }

                window.desktopEvents?.send(MainEvents.UPDATER_START)
                window.desktopEvents?.send(MainEvents.CHECK_MUSIC_INSTALL)
                window.desktopEvents?.send(MainEvents.UI_READY)
                const [musicStatus, fetchedAddons] = await Promise.all([
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_STATUS),
                    window.desktopEvents?.invoke(MainEvents.GET_ADDONS),
                ])
                setMusicInstalled(musicStatus)
                setAddons(fetchedAddons)

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
            router.navigate('/', { replace: true })
        }
    }, [user.id])

    const invokeFileEvent = async (eventType: string, filePath: string, data?: any) => {
        return await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, eventType, filePath, data)
    }

    useEffect(() => {
        const handleOpenAddon = (_event: any, data: string) => {
            window.desktopEvents
                ?.invoke(MainEvents.GET_ADDONS)
                .then((fetchedAddons: Addon[]) => {
                    const foundAddon = fetchedAddons.find(t => t.name === data)
                    if (foundAddon) {
                        if (!foundAddon.type || (foundAddon.type !== 'theme' && foundAddon.type !== 'script')) {
                            toast.custom('error', 'Ошибка.', 'У аддона отсутствует поле type или оно некорректно', null, null, 15000)
                            return
                        }
                        setAddons(fetchedAddons)
                        setNavigateTo(`/extension/${foundAddon.name}`)
                        setNavigateState(foundAddon)
                    }
                })
                .catch(error => console.error('Error getting themes:', error))
        }
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
    }, [])

    useEffect(() => {
        if (navigateTo && navigateState) {
            router.navigate(navigateTo, { state: { theme: navigateState } })
        }
    }, [navigateTo, navigateState])

    const onRpcLog = useCallback((_: any, data: any) => {
        switch (data.type) {
            case 'error':
                toast.custom('error', 'Ошибка.', 'RPC: ' + data.message, null, null, 15000)
                break
            case 'success':
                toast.custom('success', 'Успешно.', 'RPC: ' + data.message, null, null, 15000)
                break
            case 'info':
                toast.custom('info', 'Информация.', 'RPC: ' + data.message)
                break
            case 'warn':
                toast.custom('warning', 'Предупреждение.', 'RPC: ' + data.message)
                break
        }
    }, [])
    useEffect(() => {
        if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
            if (!window.desktopEvents) return

            window.desktopEvents?.on(RendererEvents.DISCORD_RPC_STATE, (_event, data) => {
                setApp(prevSettings => ({
                    ...prevSettings,
                    discordRpc: {
                        ...prevSettings.discordRpc,
                        status: data,
                    },
                }))
            })

            window.desktopEvents?.on(RendererEvents.CHECK_MOD_UPDATE, async () => {
                await fetchModInfo(app)
            })

            window.desktopEvents?.on(RendererEvents.CLIENT_READY, () => {
                window.desktopEvents?.send(MainEvents.REFRESH_MOD_INFO)
                window.desktopEvents?.send(MainEvents.GET_TRACK_INFO)
            })

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

            window.desktopEvents?.on(RendererEvents.CHECK_UPDATE, (_event, data) => {
                if (!toastReference.current) {
                    toastReference.current = toast.custom('loading', 'Проверка обновлений', 'Ожидайте...')
                }
                if (!data.updateAvailable) {
                    toast.update(toastReference.current!, {
                        kind: 'info',
                        title: 'Эвана как...',
                        msg: 'Обновление не найдено',
                        sticky: false,
                        duration: 5000,
                    })
                    toastReference.current = null
                }
            })

            const onDownloadProgress = (_e: any, value: number) => {
                toast.update(toastReference.current!, {
                    kind: 'loading',
                    title: 'Загрузка',
                    msg: (
                        <>
                            Загрузка обновления&nbsp;
                            <b>{Math.floor(value)}%</b>
                        </>
                    ),
                    value,
                })
            }

            const onDownloadFailed = () => {
                toast.update(toastReference.current!, {
                    kind: 'error',
                    title: 'Ошибка',
                    msg: 'Ошибка загрузки обновления',
                    sticky: false,
                })
                toastReference.current = null
            }

            const onDownloadFinished = () => {
                toast.update(toastReference.current!, {
                    kind: 'success',
                    title: 'Успешно',
                    msg: 'Обновление загружено',
                    sticky: false,
                    duration: 5000,
                })
                toastReference.current = null
                setUpdate(true)
            }

            window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, onDownloadProgress)
            window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_FAILED, onDownloadFailed)
            window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_FINISHED, onDownloadFinished)

            const loadSettings = async () => {
                await fetchSettings(setApp)
            }
            loadSettings()

            return () => {
                window.desktopEvents?.removeListener(RendererEvents.RPC_LOG, onRpcLog)
                window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_UPDATE_PROGRESS)
                window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_UPDATE_FAILED)
                window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
                window.desktopEvents?.removeAllListeners(RendererEvents.CHECK_UPDATE)
                window.desktopEvents?.removeAllListeners(RendererEvents.DISCORD_RPC_STATE)
                window.desktopEvents?.removeAllListeners(RendererEvents.CLIENT_READY)
                window.desktopEvents?.removeAllListeners(RendererEvents.CHECK_MOD_UPDATE)
            }
        }
    }, [])

    const setAppWithSocket = useCallback(
        (updater: (prev: SettingsInterface) => SettingsInterface) => {
            setApp(prevSettings => {
                const updatedSettings = typeof updater === 'function' ? updater(prevSettings) : updater

                if (socketIo && socketIo.connected) {
                    const socketInfo = { ...updatedSettings }
                    delete (socketInfo as any).tokens
                    delete (socketInfo as any).info
                    socketIo.emit('user_settings_update', socketInfo)
                }

                return updatedSettings
            })
        },
        [socketIo],
    )

    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
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
    }
    return (
        <div className="app-wrapper">
            <Toaster position="top-center" reverseOrder={false} />
            <UserContext.Provider
                value={{
                    user,
                    setUser,
                    authorize,
                    loading: loading || meLoading,
                    musicInstalled,
                    setMusicInstalled,
                    socket: socketIo,
                    socketConnected,
                    app,
                    setApp: setAppWithSocket,
                    updateAvailable,
                    setUpdate,
                    appInfo,
                    setAddons,
                    addons,
                    setMod: setMod,
                    modInfo: modInfo,
                    features,
                    setFeatures,
                }}
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
    const { user, app, socket, features } = useContext(UserContext)
    const [track, setTrack] = useState<Track>(trackInitials)
    const lastSentTrack = useRef({ title: null as string | null, status: null as string | null, progressPlayed: null as number | null })
    const lastSendAt = useRef(0)

    const handleSendTrackPlayedEnough = useCallback(
        (_e: any, data: any) => {
            if (!data) return
            if (socket && socket.connected) {
                socket.emit('track_played_enough', { track: { id: data.realId } })
            }
        },
        [socket],
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
            setTrack(trackInitials)
        }
    }, [user.id, handleSendTrackPlayedEnough, handleTrackInfo])

    useEffect(() => {
        if (!app.discordRpc.status || user.id === '-1') {
            if ((window as any)?.discordRpc?.clearActivity) {
                ;(window as any).discordRpc.clearActivity()
            }
            return
        }

        const activity = buildDiscordActivity(track, app)

        if (!activity) {
            if ((window as any)?.discordRpc?.clearActivity) {
                ;(window as any).discordRpc.clearActivity()
            }
            return
        }

        if ((window as any)?.discordRpc?.setActivity) {
            ;(window as any).discordRpc.setActivity(activity)
        }
    }, [app, user.id, track])

    useEffect(() => {
        if (!socket || !features.sendTrack) return
        const { title, status, sourceType, progress } = track

        const progressPlayed = progress?.position
        if (!title || sourceType === 'ynison' || !['playing', 'paused'].includes(status)) return

        const now = Date.now()
        if (now - lastSendAt.current < 1000) return

        const last = lastSentTrack.current
        if (last.title === title && last.status === status && last.progressPlayed === progressPlayed) return

        socket.emit('send_track', track)

        lastSentTrack.current = { title, status, progressPlayed }
        lastSendAt.current = now
    }, [socket, track, features.sendTrack])

    useEffect(() => {
        if (!socket) return

        const send = () => {
            if (!features.sendMetrics) return
            const enabledTheme = (window as any)?.electron?.store?.get('addons.theme')
            const enabledScripts = (window as any)?.electron?.store?.get('addons.scripts')
            socket.emit('send_metrics', { theme: enabledTheme || 'Default', scripts: enabledScripts || [] })
        }

        send()

        const id = setInterval(send, 15 * 60 * 1000)
        return () => clearInterval(id)
    }, [socket, features.sendMetrics])

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
