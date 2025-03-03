import React, { useContext, useEffect, useRef, useState } from 'react'
import { createHashRouter, RouterProvider } from 'react-router'
import UserMeQuery from '../api/queries/user/getMe.query'

import Dev from './dev'
import AuthPage from './auth'
import CallbackPage from './auth/callback'
import TrackInfoPage from './trackinfo'
import UsersPage from './users'
import ExtensionBetaPage from './extensionbeta'
import ExtensionViewPage from './extensionbeta/route/extensionview'
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
import { fixStrings, replaceParams, truncateLabel } from '../utils/formatRpc'
import { fetchSettings } from '../api/settings'
import { checkInternetAccess, compareVersions, notifyUserRetries } from '../utils/utils'
import AddonInterface from '../api/interfaces/addon.interface'
import AddonInitials from '../api/initials/addon.initials'
import { ModInterface } from '../api/interfaces/modInterface'
import modInitials from '../api/initials/mod.initials'
import GetModQuery from '../api/queries/getMod.query'
import { Track } from '../api/interfaces/track.interface'
import * as Sentry from '@sentry/electron/renderer'
import client from '../api/apolloClient'
import ErrorBoundary from '../components/errorBoundary/errorBoundary'
import { UserProfileModalProvider } from '../context/UserProfileModalContext'
import { useDispatch } from 'react-redux'
import { setDeprecatedStatus } from '../api/store/appSlice'

function App() {
    const [socketIo, setSocket] = useState<Socket | null>(null)
    const [socketError, setSocketError] = useState(-1)
    const [socketConnected, setSocketConnected] = useState(false)
    const [updateAvailable, setUpdate] = useState(false)
    const [user, setUser] = useState<UserInterface>(userInitials)
    const [app, setApp] = useState<SettingsInterface>(settingsInitials)
    const [modInfo, setMod] = useState<ModInterface[]>(modInitials)
    const [addons, setAddons] = useState<AddonInterface[]>(AddonInitials)
    const [features, setFeatures] = useState({})
    const [navigateTo, setNavigateTo] = useState<string | null>(null)
    const [navigateState, setNavigateState] = useState<AddonInterface | null>(null)
    const [loading, setLoading] = useState(true)
    const toastReference = useRef<string | null>(null)
    const socket = io(config.SOCKET_URL, {
        path: '/ws',
        autoConnect: false,
        auth: {
            token: getUserToken(),
        },
    })
    const [appInfo, setAppInfo] = useState<AppInfoInterface[]>([])
    const dispatch = useDispatch()
    const router = createHashRouter([
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
            path: '/extensionbeta',
            element: (
                <ErrorBoundary>
                    <ExtensionBetaPage />
                </ErrorBoundary>
            ),
        },
        {
            path: '/extensionbeta/:contactId',
            element: (
                <ErrorBoundary>
                    <ExtensionViewPage />
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
    ])

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
                        const isDeprecated = e.graphQLErrors.some(
                            (error: any) => error.extensions?.originalError?.error === 'DEPRECATED_VERSION',
                        )
                        const isForbidden = e.graphQLErrors.some((error: any) => error.extensions?.code === 'FORBIDDEN')
                        if (isForbidden) {
                            sendErrorAuthNotify('Ваша сессия истекла. Пожалуйста, войдите снова.')
                            if (window.electron.store.has('tokens.token')) {
                                window.electron.store.delete('tokens.token')
                            }
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
                            dispatch(setDeprecatedStatus(true))
                            if (window.electron.store.has('tokens.token')) {
                                window.electron.store.delete('tokens.token')
                            }
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
                if (event.button === 3 || event.button === 4) {
                    event.preventDefault()
                }
            }

            window.addEventListener('mouseup', handleMouseButton)
            return () => {
                clearInterval(intervalId)
                window.removeEventListener('mouseup', handleMouseButton)
            }
        }
    }, [])

    socket.on('connect', () => {
        console.log('Socket connected')
        toast.custom('success', 'Фух', 'Соединение установлено')
        socket.emit('connection')
        setSocket(socket)
        setSocketConnected(true)
        setLoading(false)
    })

    socket.on('disconnect', (reason, description) => {
        console.log('Socket disconnected')
        setSocketError(1)
        setSocket(null)
        setSocketConnected(false)
    })

    socket.on('connect_error', err => {
        console.log('Socket connect error: ' + err)
        setSocketError(1)
        setSocket(null)
        setSocketConnected(false)
    })
    socket.on('logout', async err => {
        await client.resetStore()
        setUser(userInitials)
        setSocketError(1)
        setSocket(null)
        setSocketConnected(false)
        await router.navigate('/', { replace: true })
    })
    socket.on('feature_toggles', data => {
        setFeatures(data)
    })
    socket.on('deprecated_version', () => {
        toast.custom(
            'error',
            'Внимание!',
            'Ваша версия приложения устарела 😡 и скоро пректит работу. Пожалуйста, обновите приложение.',
        )
        window.desktopEvents?.send('show-notification', {
            title: 'Внимание!',
            body: 'Ваша версия приложения устарела 😡 и скоро прекратит работу. Пожалуйста, обновите приложение.',
        })
    })
    useEffect(() => {
        if (socketError === 1 || socketError === 0) {
            toast.custom('error', 'Что-то не так!', 'Сервер не доступен')
        } else if (socketConnected) {
            toast.custom('success', 'На связи', 'Соединение восстановлено')
        }
    }, [socketError])
    const fetchModInfo = async (currentApp: SettingsInterface) => {
        try {
            const res = await apolloClient.query({
                query: GetModQuery,
                fetchPolicy: 'no-cache',
            })

            const { data } = res

            if (data && data.getMod) {
                const info = (data.getMod as ModInterface[])
                    .filter(
                        info => !currentApp.mod.version || compareVersions(info.modVersion, currentApp.mod.version) > 0,
                    )
                    .sort((a, b) => compareVersions(b.modVersion, a.modVersion))

                if (info.length > 0) {
                    setMod(info)
                    if (
                        currentApp.mod.installed &&
                        currentApp.mod.version &&
                        currentApp.mod.version < info[0].modVersion
                    ) {
                        window.desktopEvents?.send('show-notification', {
                            title: 'Доступно обновление мода',
                            body: `Версия ${info[0].modVersion} доступна для установки.`,
                        })
                    }
                } else {
                    toast.custom('info', 'Всё ок!', 'Нет доступных обновлений мода')
                }
            } else {
                console.error('Invalid response format for getMod:', data)
            }
        } catch (e) {
            console.error('Failed to fetch mod info:', e)
        }
    }
    useEffect(() => {
        if (user.id !== '-1') {
            if (!socket.connected) {
                socket.connect()
            }
            window.desktopEvents?.send('updater-start')

            const fetchAppInfo = async () => {
                try {
                    const res = await fetch(`${config.SERVER_URL}/api/v1/app/info`)
                    const data = await res.json()
                    if (data.ok && Array.isArray(data.appInfo)) {
                        const sortedAppInfos = data.appInfo.sort((a: any, b: any) => b.id - a.id)
                        setAppInfo(sortedAppInfos)
                    } else {
                        console.error('Invalid response format:', data)
                    }
                } catch (error) {
                    console.error('Failed to fetch app info:', error)
                }
            }
            fetchAppInfo()
            fetchModInfo(app)

            const intervalId = setInterval(fetchModInfo, 10 * 60 * 1000)

            if (!user.badges.some(badge => badge.type === 'supporter') && !app.discordRpc.enableGithubButton) {
                setApp({
                    ...app,
                    discordRpc: {
                        ...app.discordRpc,
                        enableGithubButton: true,
                    },
                })
                window.electron.store.set('discordRpc.enableGithubButton', true)
            }
            window.desktopEvents?.send('WEBSOCKET_START')
            window.desktopEvents.invoke('getAddons').then((fetchedAddons: AddonInterface[]) => {
                setAddons(fetchedAddons)
            })

            return () => {
                clearInterval(intervalId)
            }
        } else {
            router.navigate('/', { replace: true })
        }
    }, [user.id])

    const invokeFileEvent = async (eventType: string, filePath: string, data?: any) => {
        return await window.desktopEvents?.invoke('file-event', eventType, filePath, data)
    }

    useEffect(() => {
        const handleOpenAddon = (event: any, data: string) => {
            window.desktopEvents
                ?.invoke('getAddons')
                .then((fetchedAddons: AddonInterface[]) => {
                    const foundAddon = fetchedAddons.find(t => t.name === data)
                    if (foundAddon) {
                        if (!foundAddon.type || (foundAddon.type !== 'theme' && foundAddon.type !== 'script')) {
                            toast.custom(
                                'error',
                                'Ошибка.',
                                'У аддона отсутвует поле type или оно некорректно',
                                null,
                                null,
                                15000,
                            )
                            return
                        }
                        setAddons(fetchedAddons)
                        setNavigateTo(`/extensionbeta/${foundAddon.name}`)
                        setNavigateState(foundAddon)
                    }
                })
                .catch(error => console.error('Error getting themes:', error))
        }
        window.desktopEvents?.on('open-theme', handleOpenAddon)

        window.desktopEvents?.on('check-file-exists', filePath => invokeFileEvent('check-file-exists', filePath))
        window.desktopEvents?.on('read-file', filePath => invokeFileEvent('read-file', filePath))
        window.desktopEvents?.on('create-config-file', (filePath, defaultContent) =>
            invokeFileEvent('create-config-file', filePath, defaultContent),
        )
        window.desktopEvents?.on('write-file', (filePath, data) => invokeFileEvent('write-file', filePath, data))

        return () => {
            window.desktopEvents?.removeAllListeners('create-config-file')
            window.desktopEvents?.removeAllListeners('open-theme')
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

    useEffect(() => {
        if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
            window.desktopEvents?.on('discordRpcState', (event, data) => {
                setApp(prevSettings => ({
                    ...prevSettings,
                    discordRpc: {
                        ...prevSettings.discordRpc,
                        status: data,
                    },
                }))
            })
            window.desktopEvents?.on('check-mod-update', async (event, data) => {
                await fetchModInfo(app)
            })
            window.desktopEvents?.on('rpc-log', (event, data) => {
                switch (data.type) {
                    case 'error':
                        toast.custom('error', 'Ошибка.', 'RPC: ' + data.message)
                        break
                    case 'success':
                        toast.custom('success', 'Успешно.', 'RPC: ' + data.message)
                        break
                    case 'info':
                        toast.custom('info', 'Информация.', 'RPC: ' + data.message)
                        break
                    case 'warn':
                        toast.custom('warning', 'Предупреждение.', 'RPC: ' + data.message)
                        break
                }
            })
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

                if (data.updateAvailable) {
                    const onDownloadProgress = (event: any, value: any) => {
                        toast.custom(
                            'loading',
                            'Загрузка.',
                            <>
                                <span>Загрузка обновления</span>
                                <b style={{ marginLeft: '.5em' }}>{Math.floor(value)}%</b>
                            </>,
                            { id: toastReference.current },
                            value,
                        )
                    }

                    const onDownloadFailed = () => {
                        toast.custom('error', 'Ошибка.', 'Ошибка загрузки обновления', { id: toastReference.current })
                        toastReference.current = null
                    }

                    const onDownloadFinished = () => {
                        toast.custom('success', 'Успешно.', 'Обновление загружено', {
                            id: toastReference.current,
                        })
                        toastReference.current = null
                        setUpdate(true)
                    }

                    window.desktopEvents?.on('download-update-progress', onDownloadProgress)
                    window.desktopEvents?.on('download-update-failed', onDownloadFailed)
                    window.desktopEvents?.on('download-update-finished', onDownloadFinished)
                } else {
                    toast.custom('info', 'О как...', 'Обновление не найдено', {
                        id: toastReference.current,
                    })
                    toastReference.current = null
                }
            })
            const loadSettings = async () => {
                await fetchSettings(setApp)
            }
            loadSettings()
        }
        return () => {
            window.desktopEvents?.removeAllListeners('download-update-progress')
            window.desktopEvents?.removeAllListeners('download-update-failed')
            window.desktopEvents?.removeAllListeners('download-update-finished')
            window.desktopEvents?.removeAllListeners('check-update')
            window.desktopEvents?.removeAllListeners('discordRpcState')
            window.desktopEvents?.removeAllListeners('rpc-log')
        }
    }, [])

    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
        ;(window as any).setToken = async (args: any) => {
            window.electron.store.set('tokens.token', args)
            await authorize()
        }
        ;(window as any).refreshAddons = async (args: any) => {
            window.desktopEvents.invoke('getAddons').then((fetchedAddons: AddonInterface[]) => {
                setAddons(fetchedAddons)
                router.navigate('/extensionbeta', { replace: true })
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
                    socket: socketIo,
                    socketConnected,
                    app,
                    setApp,
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
                        <CssVarsProvider>
                            {loading ? (
                                <Preloader />
                            ) : (
                                <UserProfileModalProvider>
                                    <RouterProvider router={router} />
                                </UserProfileModalProvider>
                            )}
                        </CssVarsProvider>
                    </SkeletonTheme>
                </Player>
            </UserContext.Provider>
        </div>
    )
}

const Player: React.FC<any> = ({ children }) => {
    const { user, app, socket, features } = useContext(UserContext)
    const [track, setTrack] = useState<Track>(trackInitials)
    const lastSentTrack = useRef({
        title: null,
        status: null,
        progressPlayed: null,
    })
    useEffect(() => {
        if (user.id !== '-1') {
            ;(async () => {
                if (typeof window !== 'undefined') {
                    window.desktopEvents?.on('trackinfo', (event, data) => {
                        let coverImg: any
                        if (data.track?.coverUri) {
                            coverImg = `https://${data.track.coverUri.replace('%%', '1000x1000')}`
                        }

                        const timecodes = data.timecodes ?? [0, 0]
                        setTrack(prevTrack => ({
                            ...prevTrack,
                            downloadInfo: data.downloadInfo || null,
                            currentDevice: data.currentDevice || null,
                            sourceType: data.sourceType || null,
                            status: data.status ?? '',
                            ynisonProgress: data.ynisonProgress ?? 0,
                            event: data.event ?? '',
                            progress: data.progress ?? 0,
                            speed: data.speed ?? 1,
                            volume: data.volume ?? 1,
                            durationMs: data.track?.durationMs ?? 0,
                            url: data.url ?? '',
                            albumArt: coverImg,
                            trackSource: data.track?.trackSource ?? '',
                            timestamps: timecodes ?? [0, 0],
                            realId: data.track?.realId ?? '',
                            imageUrl: data.track?.imageUrl ?? '',
                            id: data.track?.id ?? '',
                            title: data.track?.title ?? '',
                            artists:
                                data.track?.artists?.map((artist: any) => ({
                                    id: artist.id ?? null,
                                    name: artist.name ?? 'Unknown Artist',
                                    various: artist.various ?? false,
                                    composer: artist.composer ?? false,
                                    available: artist.available ?? false,
                                    cover: {
                                        type: artist.cover?.type ?? null,
                                        uri: artist.cover?.uri ?? null,
                                        prefix: artist.cover?.prefix ?? null,
                                    },
                                    genres: artist.genres ?? [],
                                    disclaimers: artist.disclaimers ?? [],
                                })) ?? [],
                            albums:
                                data.track?.albums?.map((album: any) => ({
                                    id: album.id ?? 0,
                                    title: album.title ?? '',
                                    type: album.type ?? '',
                                    metaType: album.metaType ?? '',
                                    year: album.year ?? 0,
                                    releaseDate: album.releaseDate ?? '',
                                    coverUri: album.coverUri ?? '',
                                    ogImage: album.ogImage ?? '',
                                    genre: album.genre ?? '',
                                    trackCount: album.trackCount ?? 0,
                                    likesCount: album.likesCount ?? 0,
                                    recent: album.recent ?? false,
                                    veryImportant: album.veryImportant ?? false,
                                    artists:
                                        data.track?.artists?.map((artist: any) => ({
                                            id: artist.id ?? null,
                                            name: artist.name ?? 'Unknown Artist',
                                            various: artist.various ?? false,
                                            composer: artist.composer ?? false,
                                            available: artist.available ?? false,
                                            cover: {
                                                type: artist.cover?.type ?? null,
                                                uri: artist.cover?.uri ?? null,
                                                prefix: artist.cover?.prefix ?? null,
                                            },
                                            genres: artist.genres ?? [],
                                            disclaimers: artist.disclaimers ?? [],
                                        })) ?? [],
                                })) ?? [],
                            coverUri: data.track?.coverUri ?? '',
                            ogImage: data.track?.ogImage ?? null,
                            lyricsAvailable: data.track?.lyricsAvailable ?? null,
                            type: data.track?.type ?? null,
                            rememberPosition: data.track?.rememberPosition ?? null,
                            trackSharingFlag: data.track?.trackSharingFlag ?? null,
                        }))
                    })
                    return () => {
                        window.desktopEvents?.removeAllListeners('trackinfo')
                        setTrack(trackInitials)
                    }
                }
            })()
        } else {
            window.discordRpc.clearActivity()
        }
    }, [user.id])

    const getCoverImage = (track: Track): string => {
        return (
            track.albumArt ||
            track.coverUri ||
            track.ogImage ||
            'https://cdn.discordapp.com/app-assets/984031241357647892/1180527644668862574.png'
        )
    }

    const getTrackStartTime = (track: Track): number => {
        return track.timestamps && track.timestamps.length > 0 ? track.timestamps[0] : 0
    }

    const getTrackEndTime = (track: Track): number => {
        return track.timestamps && track.timestamps.length > 0 ? track.timestamps[1] : 0
    }

    useEffect(() => {
        if (app.discordRpc.status && user.id !== '-1') {
            if (track.title === '' || (track.status === 'paused' && !app.discordRpc.displayPause)) {
                window.discordRpc.clearActivity()
                return
            }
            if (track.sourceType === 'ynison') {
                const shareTrackPath = `album/${track.albums?.[0]?.id}/track/${track.id}`
                const deepShareTrackUrl = `yandexmusic://${shareTrackPath}`
                let startTimestamp = Math.round(Date.now() - track.ynisonProgress * 1000)
                let endTimestamp = startTimestamp + track.durationMs

                const activity: any = {
                    type: 2,
                    details: track.title,
                    largeImageKey: `https://${track.coverUri.replace('%%', '1000x1000')}`,
                    smallImageKey:
                        'https://cdn.discordapp.com/app-assets/1124055337234858005/1250833449380614155.png?size=256',
                    smallImageText: app.discordRpc.showVersionOrDevice
                        ? app.info.version
                        : ' on ' + (track.currentDevice?.info?.type ?? 'DESKTOP'),
                    buttons: [],
                }
                if (track.status === 'paused' && app.discordRpc.displayPause) {
                    activity.smallImageText = 'Paused'
                    activity.smallImageKey =
                        'https://cdn.discordapp.com/app-assets/984031241357647892/1340838860963450930.png?size=256'
                    activity.details = fixStrings(track.title)
                    delete activity.startTimestamp
                    delete activity.endTimestamp
                } else if (!track.id.includes('generative')) {
                    activity.startTimestamp = startTimestamp
                    activity.endTimestamp = endTimestamp
                }

                if (app.discordRpc.enableRpcButtonListen) {
                    activity.buttons.push({
                        label: app.discordRpc.button ? truncateLabel(app.discordRpc.button) : '✌️ Open in Yandex Music',
                        url: deepShareTrackUrl,
                    })
                }
                if (app.discordRpc.enableGithubButton) {
                    activity.buttons.push({
                        label: '♡ PulseSync Project',
                        url: 'https://github.com/PulseSync-LLC/YMusic-DRPC/tree/dev',
                    })
                }
                if (activity.buttons.length === 0) {
                    delete activity.buttons
                }
                window.discordRpc.setActivity(activity)
                return
            } else {
                if (
                    track.title === '' ||
                    (track.status === 'paused' && !app.discordRpc.displayPause) ||
                    (track.timestamps[0] === 0 && track.timestamps[1] === 0)
                ) {
                    window.discordRpc.clearActivity()
                    return
                } else {
                    const trackStartTime = getTrackStartTime(track)
                    const trackEndTime = getTrackEndTime(track)
                    const artistName = track.artists.map(x => x.name).join(', ')

                    const startTimestamp =
                        Math.floor(Date.now() / 1000) * 1000 - Math.floor(Number(trackStartTime)) * 1000
                    const endTimestamp = startTimestamp + Math.floor(Number(trackEndTime)) * 1000

                    const activity: any = {
                        type: 2,
                        largeImageKey: getCoverImage(track),
                        smallImageKey:
                            'https://cdn.discordapp.com/app-assets/1124055337234858005/1250833449380614155.png',
                        smallImageText: app.discordRpc.showVersionOrDevice ? app.info.version : ' on DESKTOP',
                        details:
                            app.discordRpc.details.length > 0
                                ? fixStrings(replaceParams(app.discordRpc.details, track))
                                : fixStrings(track.title || 'Unknown Track'),
                        state:
                            app.discordRpc.state.length > 0
                                ? fixStrings(replaceParams(app.discordRpc.state, track))
                                : fixStrings(artistName || 'Unknown Artist'),
                    }

                    if (track.status === 'paused' && app.discordRpc.displayPause) {
                        activity.smallImageText = 'Paused'
                        activity.smallImageKey =
                            'https://cdn.discordapp.com/app-assets/984031241357647892/1340838860963450930.png?size=256'
                        activity.details = fixStrings(track.title)
                        delete activity.startTimestamp
                        delete activity.endTimestamp
                    } else if (!track.id.includes('generative')) {
                        activity.startTimestamp = startTimestamp
                        activity.endTimestamp = endTimestamp
                    }

                    activity.buttons = []

                    if (
                        track.trackSource !== 'UGC' &&
                        !track.id.includes('generative') &&
                        app.discordRpc.enableRpcButtonListen
                    ) {
                        const linkTitle = track.albums[0].id
                        activity.buttons.push({
                            label: app.discordRpc.button
                                ? truncateLabel(app.discordRpc.button)
                                : '✌️ Open in Yandex Music',
                            url: `yandexmusic://album/${encodeURIComponent(linkTitle)}/track/${track.realId}`,
                        })
                    } else if (
                        track.trackSource === 'UGC' &&
                        !track.id.includes('generative') &&
                        app.discordRpc.enableRpcButtonListen
                    ) {
                        activity.buttons.push({
                            label: app.discordRpc.button ? truncateLabel(app.discordRpc.button) : '✌️ Open music file',
                            url: track.url,
                        })
                    }

                    if (app.discordRpc.enableGithubButton) {
                        activity.buttons.push({
                            label: '♡ PulseSync Project',
                            url: `https://github.com/PulseSync-LLC/YMusic-DRPC/tree/dev`,
                        })
                    }

                    if (activity.buttons.length === 0) {
                        delete activity.buttons
                    }

                    if ((!track.artists || track.artists.length === 0) && track.trackSource !== 'UGC') {
                        setTrack(prevTrack => {
                            if (prevTrack.title && prevTrack.title.endsWith(' - Нейромузыка')) {
                                return prevTrack
                            }
                            return {
                                ...prevTrack,
                                title: `${track.title} - Нейромузыка`,
                            }
                        })

                        if (!track.title.endsWith(' - Нейромузыка')) {
                            activity.details = fixStrings(`${track.title} - Нейромузыка`)
                        } else {
                            activity.details = fixStrings(track.title)
                        }

                        if (track.imageUrl.includes('%%')) {
                            activity.largeImageKey = `https://${track.imageUrl.replace('%%', '1000x1000')}`
                        }

                        delete activity.state
                    }
                    window.discordRpc.setActivity(activity)
                }
            }
        }
    }, [app.settings, user, track, app.discordRpc])
    useEffect(() => {
        if (socket && features.sendTrack && track.title !== '' && track.sourceType !== 'ynison') {
            const { title, status, progress } = track
            if (
                title !== lastSentTrack.current.title ||
                status !== lastSentTrack.current.status ||
                progress.position !== lastSentTrack.current.progressPlayed
            ) {
                socket.emit('send_track', track)

                lastSentTrack.current = {
                    title,
                    status,
                    progressPlayed: progress.position,
                }
            }
        }
    }, [socket, track, features.sendTrack])
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
