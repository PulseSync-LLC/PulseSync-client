import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
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
import { fixStrings, replaceParams, truncateLabel } from '../utils/formatRpc'
import { fetchSettings } from '../api/settings'
import { checkInternetAccess, compareVersions, notifyUserRetries } from '../utils/utils'
import Addon from '../api/interfaces/addon.interface'
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
import { setAppDeprecatedStatus } from '../api/store/appSlice'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'

const STATUS_DISPLAY_TYPES: Record<number, number> = {
    0: 0,
    1: 1,
    2: 2,
}

class ConvertableLink {
    link?: string
    constructor(link?: string) {
        this.link = link
    }
    toString() {
        return this.link ?? ''
    }
    toWeb() {
        if (!this.link) return undefined
        return `https://music.yandex.ru/${this.link}?utm_source=discord&utm_medium=rich_presence_click`
    }
    toApp() {
        if (!this.link) return undefined
        return `yandexmusic://${this.link}`
    }
}

function buildShareLinks(t: Track) {
    const albumId = t.albums?.[0]?.id
    const trackId = t.id
    const realTrackId = t.realId
    const artistId = t.artists?.[0]?.id

    const shareTrackPathYnison = new ConvertableLink(albumId && trackId ? `album/${albumId}/track/${trackId}` : undefined)
    const shareTrackPathRegular = new ConvertableLink(albumId && realTrackId ? `album/${albumId}/track/${realTrackId}` : undefined)
    const shareAlbumPath = new ConvertableLink(albumId ? `album/${albumId}` : undefined)
    const shareArtistPath = new ConvertableLink(artistId ? `artist/${artistId}` : undefined)

    return { shareTrackPathYnison, shareTrackPathRegular, shareAlbumPath, shareArtistPath }
}

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

    const socket = io(config.SOCKET_URL, {
        path: '/ws',
        autoConnect: false,
        auth: {
            page: window.location.pathname,
            token: getUserToken(),
            version: app?.info?.version,
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
                if (event.button === 3 || event.button === 4) {
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

    socket.on('connect', () => {
        console.log('Socket connected')
        toast.custom('success', 'Фух', 'Соединение установлено')
        socket.emit('connection')
        setSocket(socket)
        setSocketConnected(true)
        setLoading(false)
    })

    socket.on('disconnect', () => {
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
        toast.custom('error', 'Внимание!', 'Ваша версия приложения устарела 🤠 и скоро прекратит работу. Пожалуйста, обновите приложение.')
        window.desktopEvents?.send('show-notification', {
            title: 'Внимание!',
            body: 'Ваша версия приложения устарела 🤠 и скоро прекратит работу. Пожалуйста, обновите приложение.',
        })
    })
    useEffect(() => {
        if (socketError === 1 || socketError === 0) {
            toast.custom('error', 'Что-то не так!', 'Сервер не доступен')
        } else if (socketConnected) {
            toast.custom('success', 'На связи', 'Соединение восстановлено')
        }
    }, [socketError])

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
            console.log(app.mod)
            if (!app.mod.installed || !app.mod.version) {
                toast.custom('info', 'Мод не установлен', `Доступна установка версии ${latest.modVersion}`)
                return
            }
            console.log(latest.modVersion)
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
                if (!socket.connected) {
                    socket.connect()
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
        title: null as string | null,
        status: null as string | null,
        progressPlayed: null as number | null,
    })

    useEffect(() => {
        if (user.id !== '-1') {
            ;(async () => {
                if (typeof window !== 'undefined') {
                    window.desktopEvents?.on('SEND_TRACK', async (event, data) => {
                        if (!data) return

                        if (socket && socket.connected) {
                            socket.emit('track_played_enough', {
                                track: {
                                    id: data.realId,
                                },
                            })
                        }
                    })
                    window.desktopEvents?.on('TRACK_INFO', (event, data) => {
                        if (!data) return
                        if (data.type === 'refresh') {
                            return setTrack(trackInitials)
                        }
                        let coverImg: any
                        if (data.track?.coverUri) {
                            coverImg = `https://${data.track.coverUri.replace('%%', '1000x1000')}`
                        }
                        setTrack(prev => ({
                            ...prev,
                            albumArt: coverImg,
                            isPlaying: data.isPlaying ?? prev.isPlaying,
                            canMoveBackward: data.canMoveBackward ?? prev.canMoveBackward,
                            canMoveForward: data.canMoveForward ?? prev.canMoveForward,
                            status: data.status ?? prev.status,
                            sourceType: data.track?.sourceType ?? prev.sourceType,
                            ynisonProgress: data.ynisonProgress ?? prev.ynisonProgress,
                            progress: {
                                duration: data.progress?.duration ?? prev.progress.duration,
                                loaded: data.progress?.loaded ?? prev.progress.loaded,
                                position: data.progress?.position ?? prev.progress.position,
                                played: data.progress?.played ?? prev.progress.played,
                            },
                            availableActions: {
                                moveBackward: data.availableActions?.moveBackward ?? prev.availableActions.moveBackward,
                                moveForward: data.availableActions?.moveForward ?? prev.availableActions.moveForward,
                                repeat: data.availableActions?.repeat ?? prev.availableActions.repeat,
                                shuffle: data.availableActions?.shuffle ?? prev.availableActions.shuffle,
                                speed: data.availableActions?.speed ?? prev.availableActions.speed,
                            },
                            actionsStore: {
                                repeat: data.actionsStore?.repeat ?? prev.actionsStore.repeat,
                                shuffle: data.actionsStore?.shuffle ?? prev.actionsStore.shuffle,
                                isLiked: data.actionsStore?.isLiked ?? prev.actionsStore.isLiked,
                                isDisliked: data.actionsStore?.isDisliked ?? prev.actionsStore.isDisliked,
                            },
                            currentDevice: data.currentDevice ?? prev.currentDevice,
                            downloadInfo: data.downloadInfo ?? prev.downloadInfo,
                            id: data.track?.id ?? prev.id,
                            realId: data.track?.realId ?? prev.realId,
                            title: data.track?.title ?? prev.title,
                            major: {
                                id: data.track?.major?.id ?? prev.major.id,
                                name: data.track?.major?.name ?? prev.major.name,
                            },
                            version: data.track?.version,
                            available: data.track?.available ?? prev.available,
                            availableForPremiumUsers: data.track?.availableForPremiumUsers ?? prev.availableForPremiumUsers,
                            availableFullWithoutPermission: data.track?.availableFullWithoutPermission ?? prev.availableFullWithoutPermission,
                            availableForOptions: data.track?.availableForOptions ?? prev.availableForOptions,
                            disclaimers: data.track?.disclaimers ?? prev.disclaimers,
                            storageDir: data.track?.storageDir ?? prev.storageDir,
                            durationMs: data.track?.durationMs ?? prev.durationMs,
                            fileSize: data.track?.fileSize ?? prev.fileSize,
                            r128: {
                                i: data.track?.r128?.i ?? prev.r128.i,
                                tp: data.track?.r128?.tp ?? prev.r128.tp,
                            },
                            fade: {
                                inStart: data.track?.fade?.inStart ?? prev.fade.inStart,
                                inStop: data.track?.fade?.inStop ?? prev.fade.inStop,
                                outStart: data.track?.fade?.outStart ?? prev.fade.outStart,
                                outStop: data.track?.fade?.outStop ?? prev.fade.outStop,
                            },
                            previewDurationMs: data.track?.previewDurationMs ?? prev.previewDurationMs,
                            artists:
                                data.track?.artists?.map(
                                    (artist: {
                                        id: any
                                        name: any
                                        various: any
                                        composer: any
                                        available: any
                                        cover: { type: any; uri: any; prefix: any }
                                        genres: any
                                        disclaimers: any
                                    }) => ({
                                        id: artist.id ?? 0,
                                        name: artist.name ?? '',
                                        various: artist.various ?? false,
                                        composer: artist.composer ?? false,
                                        available: artist.available ?? false,
                                        cover: {
                                            type: artist.cover?.type ?? '',
                                            uri: artist.cover?.uri ?? '',
                                            prefix: artist.cover?.prefix ?? '',
                                        },
                                        genres: artist.genres ?? [],
                                        disclaimers: artist.disclaimers ?? [],
                                    }),
                                ) ?? prev.artists,
                            albums:
                                data.track?.albums?.map(
                                    (album: {
                                        id: any
                                        title: any
                                        metaType: any
                                        version: any
                                        year: any
                                        releaseDate: any
                                        coverUri: any
                                        ogImage: any
                                        genre: any
                                        trackCount: any
                                        likesCount: any
                                        recent: any
                                        veryImportant: any
                                        artists: any[]
                                        labels: any[]
                                        available: any
                                        availableForPremiumUsers: any
                                        availableForOptions: any
                                        availableForMobile: any
                                        availablePartially: any
                                        bests: any
                                        disclaimers: any
                                        listeningFinished: any
                                        trackPosition: { volume: any; index: any }
                                    }) => ({
                                        id: album.id ?? 0,
                                        title: album.title ?? '',
                                        metaType: album.metaType ?? '',
                                        version: album.version ?? '',
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
                                            album.artists?.map(a => ({
                                                id: a.id ?? 0,
                                                name: a.name ?? '',
                                                various: a.various ?? false,
                                                composer: a.composer ?? false,
                                                available: a.available ?? false,
                                                cover: {
                                                    type: a.cover?.type ?? '',
                                                    uri: a.cover?.uri ?? '',
                                                    prefix: a.cover?.prefix ?? '',
                                                },
                                                genres: a.genres ?? [],
                                                disclaimers: a.disclaimers ?? [],
                                            })) ?? [],
                                        labels:
                                            album.labels?.map(label => ({
                                                id: label.id ?? 0,
                                                name: label.name ?? '',
                                            })) ?? [],
                                        available: album.available ?? false,
                                        availableForPremiumUsers: album.availableForPremiumUsers ?? false,
                                        availableForOptions: album.availableForOptions ?? [],
                                        availableForMobile: album.availableForMobile ?? false,
                                        availablePartially: album.availablePartially ?? false,
                                        bests: album.bests ?? [],
                                        disclaimers: album.disclaimers ?? [],
                                        listeningFinished: album.listeningFinished ?? false,
                                        trackPosition: {
                                            volume: album.trackPosition?.volume ?? 0,
                                            index: album.trackPosition?.index ?? 0,
                                        },
                                    }),
                                ) ?? prev.albums,
                            derivedColors: {
                                average: data.track?.derivedColors?.average ?? prev.derivedColors.average,
                                waveText: data.track?.derivedColors?.waveText ?? prev.derivedColors.waveText,
                                miniPlayer: data.track?.derivedColors?.miniPlayer ?? prev.derivedColors.miniPlayer,
                                accent: data.track?.derivedColors?.accent ?? prev.derivedColors.accent,
                            },
                            ogImage: data.track?.ogImage ?? prev.ogImage,
                            url: data.url ?? prev.url,
                            lyricsAvailable: data.track?.lyricsAvailable ?? prev.lyricsAvailable,
                            type: data.track?.type ?? prev.type,
                            rememberPosition: data.track?.rememberPosition ?? prev.rememberPosition,
                            trackSharingFlag: data.track?.trackSharingFlag ?? prev.trackSharingFlag,
                            lyricsInfo: {
                                hasAvailableSyncLyrics: data.track?.lyricsInfo?.hasAvailableSyncLyrics ?? prev.lyricsInfo.hasAvailableSyncLyrics,
                                hasAvailableTextLyrics: data.track?.lyricsInfo?.hasAvailableTextLyrics ?? prev.lyricsInfo.hasAvailableTextLyrics,
                            },
                            trackSource: data.track?.trackSource ?? prev.trackSource,
                            specialAudioResources: data.track?.specialAudioResources ?? prev.specialAudioResources,
                        }))
                    })
                    return () => {
                        window.desktopEvents?.removeAllListeners('TRACK_INFO')
                        window.desktopEvents?.removeAllListeners('SEND_TRACK')
                        setTrack(trackInitials)
                    }
                }
            })()
        } else {
            window.discordRpc.clearActivity()
        }
    }, [user.id, socket])

    const getCoverImage = (track: Track): string => {
        return track.albumArt || 'https://cdn.discordapp.com/app-assets/984031241357647892/1180527644668862574.png'
    }

    const buildActivityButtons = useCallback((t: Track, settings: SettingsInterface) => {
        const buttons: { label: string; url: string }[] = []
        const { shareTrackPathYnison, shareTrackPathRegular } = buildShareLinks(t)
        const shareTrackPath = t.sourceType === 'ynison' ? shareTrackPathYnison : shareTrackPathRegular

        if (settings.discordRpc.enableRpcButtonListen) {
            if (t.trackSource === 'UGC' && !t.id.includes('generative') && t.url) {
                buttons.push({
                    label: settings.discordRpc.button ? truncateLabel(settings.discordRpc.button) : '✌️ Open music file',
                    url: t.url,
                })
            } else if (!t.id.includes('generative')) {
                const appUrl = shareTrackPath.toApp()
                const webUrl = shareTrackPath.toWeb()

                if (settings.discordRpc.enableDeepLink) {
                    if (settings.discordRpc.enableWebsiteButton) {
                        if (appUrl) {
                            buttons.push({ label: '✌️ Open in Yandex Music App', url: appUrl })
                        } else if (webUrl) {
                            buttons.push({ label: '✌️ Open in Yandex Music Web', url: webUrl })
                        }
                    } else {
                        if (appUrl) buttons.push({ label: '✌️ Open in Yandex Music App', url: appUrl })
                        if (webUrl && buttons.length < 2) buttons.push({ label: '✌️ Open in Yandex Music Web', url: webUrl })
                    }
                } else {
                    if (appUrl) buttons.push({ label: '✌️ Open in Yandex Music App', url: appUrl })
                }
            }
        }

        if (settings.discordRpc.enableWebsiteButton && buttons.length < 2) {
            buttons.push({
                label: '♡ PulseSync Project',
                url: 'https://pulsesync.dev',
            })
        }

        if (buttons.length > 2) {
            return buttons.slice(0, 2)
        }
        return buttons.length ? buttons : undefined
    }, [])

    const buildDiscordActivity = useCallback(
        (t: Track, settings: SettingsInterface): SetActivity | null => {
            if (t.title === '') return null
            if (t.status === 'paused' && !settings.discordRpc.displayPause) return null

            const { shareAlbumPath, shareArtistPath, shareTrackPathRegular } = buildShareLinks(t)

            if (t.sourceType === 'ynison') {
                const startTimestamp = Math.round(Date.now() - (t.ynisonProgress / 1000) * 1000)
                const endTimestamp = startTimestamp + t.durationMs

                const activity: SetActivity = {
                    statusDisplayType: STATUS_DISPLAY_TYPES[settings.discordRpc.statusDisplayType] ?? 0,
                    type: 2,
                    details: t.title,
                    largeImageKey: t.albumArt,
                    largeImageText: `PulseSync ${settings.info.version}`,
                    largeImageUrl: 'https://pulsesync.dev',
                }

                if (t.albums?.[0]?.title) {
                    activity.largeImageText = fixStrings(t.albums[0].title)
                    const web = shareAlbumPath.toWeb()
                    if (web) activity.largeImageUrl = web
                }

                if (settings.discordRpc.showSmallIcon) {
                    activity.smallImageText = settings.discordRpc.showVersionOrDevice
                        ? settings.info.version
                        : ' on ' + (t.currentDevice?.info?.type ?? 'DESKTOP')
                    activity.smallImageKey = 'https://cdn.discordapp.com/app-assets/1124055337234858005/1250833449380614155.png'
                }

                if (t.status === 'paused' && settings.discordRpc.displayPause) {
                    activity.smallImageText = 'Paused'
                    activity.smallImageKey = 'https://cdn.discordapp.com/app-assets/984031241357647892/1340838860963450930.png?size=256'
                    activity.details = fixStrings(t.title)
                    delete activity.startTimestamp
                    delete activity.endTimestamp
                } else if (!t.id.includes('generative')) {
                    activity.startTimestamp = startTimestamp
                    activity.endTimestamp = endTimestamp
                }

                const buttons = buildActivityButtons(t, settings)
                if (buttons) activity.buttons = buttons

                return activity
            } else {
                const startTimestamp = Math.round(Date.now() - t.progress.position * 1000)
                const endTimestamp = startTimestamp + t.durationMs
                const artistName = t.artists.map(x => x.name).join(', ')
                let rawDetails: string

                if (settings.discordRpc.showTrackVersion && t.version) {
                    rawDetails = `${t.title} (${t.version})`
                } else if (settings.discordRpc.details.length > 0) {
                    rawDetails = replaceParams(settings.discordRpc.details, t, settings.discordRpc.showTrackVersion)
                } else {
                    rawDetails = t.title || 'Unknown Track'
                }

                const activity: SetActivity = {
                    type: 2,
                    statusDisplayType: STATUS_DISPLAY_TYPES[settings.discordRpc.statusDisplayType] ?? 0,
                    largeImageKey: getCoverImage(t),
                    largeImageText: `PulseSync ${settings.info.version}`,
                    largeImageUrl: 'https://pulsesync.dev',
                    details: fixStrings(rawDetails),
                    detailsUrl: shareTrackPathRegular.toWeb(),
                    state:
                        settings.discordRpc.state.length > 0
                            ? fixStrings(replaceParams(settings.discordRpc.state, t))
                            : fixStrings(artistName || 'Unknown Artist'),
                    stateUrl: shareArtistPath.toWeb(),
                }

                if (t.albums?.[0]?.title) {
                    activity.largeImageText = fixStrings(t.albums[0].title)
                    const web = shareAlbumPath.toWeb()
                    if (web) activity.largeImageUrl = web
                }

                if (settings.discordRpc.showSmallIcon) {
                    activity.smallImageText = settings.discordRpc.showVersionOrDevice
                        ? settings.info.version
                        : ' on ' + (t.currentDevice?.info?.type ?? 'DESKTOP')
                    activity.smallImageKey = 'https://cdn.discordapp.com/app-assets/1124055337234858005/1250833449380614155.png'
                }

                if (t.status === 'paused' && settings.discordRpc.displayPause) {
                    activity.smallImageText = 'Paused'
                    activity.smallImageKey = 'https://cdn.discordapp.com/app-assets/984031241357647892/1340838860963450930.png?size=256'
                    activity.details = fixStrings(t.title)
                    delete activity.startTimestamp
                    delete activity.endTimestamp
                } else if (!t.id.includes('generative')) {
                    activity.startTimestamp = startTimestamp
                    activity.endTimestamp = endTimestamp
                }

                if ((!t.artists || t.artists.length === 0) && t.trackSource !== 'UGC') {
                    const newDetails = t.title.endsWith(' - Нейромузыка') ? t.title : `${t.title} - Нейромузыка`
                    activity.details = fixStrings(newDetails)
                    if (t.albumArt && t.albumArt.includes('%%')) {
                        activity.largeImageKey = `https://${t.albumArt.replace('%%', 'orig')}`
                    }
                    delete activity.state
                }

                const buttons = buildActivityButtons(t, settings)
                if (buttons) activity.buttons = buttons

                return activity
            }
        },
        [buildActivityButtons],
    )

    useEffect(() => {
        if (app.discordRpc.status && user.id !== '-1') {
            if (track.title === '' || (track.status === 'paused' && !app.discordRpc.displayPause)) {
                window.discordRpc.clearActivity()
                return
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
            }

            const activity = buildDiscordActivity(track, app)
            if (!activity) {
                window.discordRpc.clearActivity()
                return
            }
            window.discordRpc.setActivity(activity)
        }
    }, [app.settings, user, track, app.discordRpc, buildDiscordActivity])

    useEffect(() => {
        if (!socket || !features.sendTrack) return

        const { title, status, sourceType, progress } = track
        const progressPlayed = progress?.position

        if (!title || sourceType === 'ynison' || !['playing', 'paused'].includes(status)) {
            return
        }

        const last = lastSentTrack.current

        if (last.title === title && last.status === status && last.progressPlayed === progressPlayed) {
            return
        }

        socket.emit('send_track', track)
        lastSentTrack.current = { title, status, progressPlayed }
    }, [socket, track, features.sendTrack])

    useEffect(() => {
        if (socket) {
            const parseExtensions = () => {
                if (features.sendMetrics) {
                    const enabledTheme = window.electron.store.get('addons.theme')
                    const enabledScripts = window.electron.store.get('addons.scripts')
                    socket.emit('send_metrics', {
                        theme: enabledTheme || 'Default',
                        scripts: enabledScripts || [],
                    })
                }
            }
            parseExtensions()
            const metricCheckId = setInterval(parseExtensions, 15 * 60 * 1000)

            return () => {
                clearInterval(metricCheckId)
            }
        }
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
