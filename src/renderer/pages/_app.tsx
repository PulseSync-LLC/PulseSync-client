import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createHashRouter, RouterProvider } from 'react-router'
import UserMeQuery from '../api/queries/user/getMe.query'

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
            const token = await getUserToken()

            if (token) {
                const isOnline = await checkInternetAccess()
                if (!isOnline) {
                    if (retryCount > 0) {
                        notifyUserRetries(retryCount)
                        retryCount--
                        return false
                    } else {
                        toast.custom('error', 'Отдохни чуток:)', 'Превышено количество попыток подключения.')
                        window.desktopEvents?.send('authStatus', {
                            status: false,
                        })
                        setLoading(false)
                        return false
                    }
                }

                const sendErrorAuthNotify = (message: string, title?: string) => {
                    toast.custom('error', 'Ошибка', message, null, null, 10000)
                    window.desktopEvents?.send('show-notification', {
                        title: `Ошибка авторизации 😡 ${title ? title : ''}`,
                        body: message,
                    })
                }

                try {
                    const res = await apolloClient.query({
                        query: UserMeQuery,
                        fetchPolicy: 'no-cache',
                    })

                    const { data } = res
                    if (data.getMe && data.getMe.id) {
                        setUser(data.getMe)

                        await router.navigate('/trackinfo', { replace: true })

                        window.desktopEvents?.send('authStatus', {
                            status: true,
                            user: {
                                id: data.getMe.id,
                                username: data.getMe.username,
                                email: data.getMe.email,
                            },
                        })
                        return true
                    } else {
                        setLoading(false)
                        window.electron.store.delete('tokens.token')
                        await router.navigate('/', { replace: true })
                        setUser(userInitials)
                        sendErrorAuthNotify('Не удалось получить данные пользователя. Пожалуйста, войдите снова.')
                        window.desktopEvents?.send('authStatus', {
                            status: false,
                        })
                        return false
                    }
                } catch (e: any) {
                    if (e.networkError) {
                        if (retryCount > 0) {
                            notifyUserRetries(retryCount)
                            retryCount--
                            return false
                        } else {
                            toast.custom('error', 'Пинг-понг', 'Сервер недоступен. Попробуйте позже.')
                            window.desktopEvents?.send('authStatus', {
                                status: false,
                            })
                            setLoading(false)
                            return false
                        }
                    } else if (e.graphQLErrors && e.graphQLErrors.length > 0) {
                        const isDeprecated = e.graphQLErrors.some((error: any) => error.extensions?.originalError?.error === 'DEPRECATED_VERSION')
                        const isForbidden = e.graphQLErrors.some((error: any) => error.extensions?.code === 'FORBIDDEN')
                        if (isForbidden) {
                            sendErrorAuthNotify('Ваша сессия истекла. Пожалуйста, войдите снова.')
                            window.electron.store.delete('tokens.token')
                            await router.navigate('/', { replace: true })
                            setUser(userInitials)
                            window.desktopEvents?.send('authStatus', {
                                status: false,
                            })
                            return false
                        } else if (isDeprecated) {
                            sendErrorAuthNotify(
                                'Ошибка авторизации. Данная версия приложения устарела. Скачивание новой версии начнется автоматически.',
                                'Данная версия приложения устарела',
                            )
                            window.desktopEvents?.send('updater-start')
                            dispatch(setAppDeprecatedStatus(true))
                            window.electron.store.delete('tokens.token')
                            await router.navigate('/', { replace: true })
                            setUser(userInitials)
                            window.desktopEvents?.send('authStatus', {
                                status: false,
                            })
                            return false
                        }
                    } else {
                        Sentry.captureException(e)
                        toast.custom('error', 'Может у тебя нет доступа?', 'Неизвестная ошибка авторизации.')
                        window.desktopEvents?.send('authStatus', {
                            status: false,
                        })
                        setLoading(false)
                        return false
                    }
                }
            } else {
                window.desktopEvents?.send('authStatus', {
                    status: false,
                })
                setLoading(false)
                return false
            }
        }

        const retryAuthorization = async () => {
            let isAuthorized = await attemptAuthorization()

            if (!isAuthorized) {
                const retryInterval = setInterval(async () => {
                    const token = await getUserToken()

                    if (!token) {
                        window.desktopEvents?.send('authStatus', {
                            status: false,
                        })
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

        window.desktopEvents?.invoke('checkSleepMode').then(async (res: boolean) => {
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

            const handleBeforeunload = (event: BeforeUnloadEvent) => {
                window.desktopEvents?.send('discordrpc-reset-activity')
            }

            const handleAuthStatus = async (event: any) => {
                await authorize()
            }

            window.desktopEvents?.send('WEBSOCKET_START')
            window.desktopEvents?.on('authSuccess', handleAuthStatus)
            window.addEventListener('mouseup', handleMouseButton)
            window.addEventListener('beforeunload', handleBeforeunload)

            return () => {
                clearInterval(intervalId)
                window.desktopEvents?.removeAllListeners('authSuccess')
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
        const onConnectError = (err: any) => {
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
            window.desktopEvents?.send('show-notification', {
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
                    window.desktopEvents?.send('show-notification', {
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

                window.desktopEvents?.send('updater-start')
                window.desktopEvents?.send('checkMusicInstall')
                window.desktopEvents?.send('ui-ready')
                const [musicStatus, fetchedAddons] = await Promise.all([
                    window.desktopEvents?.invoke('getMusicStatus'),
                    window.desktopEvents?.invoke('getAddons'),
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
        return await window.desktopEvents?.invoke('file-event', eventType, filePath, data)
    }

    useEffect(() => {
        const handleOpenAddon = (_event: any, data: string) => {
            window.desktopEvents
                ?.invoke('getAddons')
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
        window.desktopEvents?.on('open-addon', handleOpenAddon)
        window.desktopEvents?.on('check-file-exists', (_event, filePath) => invokeFileEvent('check-file-exists', filePath))
        window.desktopEvents?.on('read-file', (_event, filePath) => invokeFileEvent('read-file', filePath))
        window.desktopEvents?.on('create-config-file', (_event, filePath, defaultContent) =>
            invokeFileEvent('create-config-file', filePath, defaultContent),
        )
        window.desktopEvents?.on('write-file', (_event, filePath, data) => invokeFileEvent('write-file', filePath, data))

        return () => {
            window.desktopEvents?.removeAllListeners('create-config-file')
            window.desktopEvents?.removeAllListeners('open-addon')
            window.desktopEvents?.removeAllListeners('check-file-exists')
            window.desktopEvents?.removeAllListeners('read-file')
            window.desktopEvents?.removeAllListeners('write-file')
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

            window.desktopEvents?.on('discordRpcState', (event, data) => {
                setApp(prevSettings => ({
                    ...prevSettings,
                    discordRpc: {
                        ...prevSettings.discordRpc,
                        status: data,
                    },
                }))
            })

            window.desktopEvents?.on('check-mod-update', async () => {
                await fetchModInfo(app)
            })

            window.desktopEvents.on('CLIENT_READY', () => {
                window.desktopEvents?.send('REFRESH_MOD_INFO')
                window.desktopEvents?.send('GET_TRACK_INFO')
            })

            window.desktopEvents?.on('rpc-log', onRpcLog)

            window.desktopEvents?.invoke('getVersion').then((version: string) => {
                setApp(prevSettings => ({
                    ...prevSettings,
                    info: {
                        ...prevSettings.info,
                        version: version,
                    },
                }))
            })

            window.desktopEvents?.on('check-update', (event, data) => {
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

            window.desktopEvents?.on('download-update-progress', onDownloadProgress)
            window.desktopEvents?.on('download-update-failed', onDownloadFailed)
            window.desktopEvents?.on('download-update-finished', onDownloadFinished)

            const loadSettings = async () => {
                await fetchSettings(setApp)
            }
            loadSettings()

            return () => {
                window.desktopEvents?.removeListener('rpc-log', onRpcLog)
                window.desktopEvents?.removeAllListeners('download-update-progress')
                window.desktopEvents?.removeAllListeners('download-update-failed')
                window.desktopEvents?.removeAllListeners('download-update-finished')
                window.desktopEvents?.removeAllListeners('check-update')
                window.desktopEvents?.removeAllListeners('discordRpcState')
                window.desktopEvents?.removeAllListeners('CLIENT_READY')
                window.desktopEvents?.removeAllListeners('check-mod-update')
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
            await authorize()
        }
        ;(window as any).refreshAddons = async (args: any) => {
            window.desktopEvents.invoke('getAddons').then((fetchedAddons: Addon[]) => {
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
                    loading,
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
                        <CssVarsProvider>{loading ? <Preloader /> : <RouterProvider router={router} />}</CssVarsProvider>
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
        de.on('SEND_TRACK', handleSendTrackPlayedEnough)
        de.on('TRACK_INFO', handleTrackInfo)

        return () => {
            de.removeListener('SEND_TRACK', handleSendTrackPlayedEnough)
            de.removeListener('TRACK_INFO', handleTrackInfo)
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
