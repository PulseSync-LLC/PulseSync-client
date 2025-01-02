import React, { useContext, useEffect, useState } from 'react'
import { createHashRouter, RouterProvider } from 'react-router'
import UserMeQuery from '../api/queries/user/getMe.query'

import AuthPage from './auth'
import CallbackPage from './auth/callback'
import TrackInfoPage from './trackinfo'
import ExtensionPage from './extension'
import UsersPage from './users'
import ExtensionBetaPage from './extensionbeta'
import ExtensionViewPage from './extensionbeta/route/extensionview'
import JointPage from './joint'

import hotToast, { Toaster } from 'react-hot-toast-magic'
import { CssVarsProvider } from '@mui/joy'
import { Socket } from 'socket.io-client'
import UserInterface from '../api/interfaces/user.interface'
import userInitials from '../api/initials/user.initials'
import { io } from 'socket.io-client'
import UserContext from '../api/context/user.context'
import toast from '../api/toast'
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
import {
    checkInternetAccess,
    compareVersions,
    notifyUserRetries,
} from '../utils/utils'
import ThemeInterface from '../api/interfaces/theme.interface'
import ThemeInitials from '../api/initials/theme.initials'
import ErrorBoundary from '../components/errorBoundary'
import { ModInterface } from '../api/interfaces/modInterface'
import modInitials from '../api/initials/mod.initials'
import GetModQuery from '../api/queries/getMod.query'
import { Track } from '../api/interfaces/track.interface'
import * as Sentry from '@sentry/electron/renderer'
import client from '../api/apolloClient'

function App() {
    const [socketIo, setSocket] = useState<Socket | null>(null)
    const [socketError, setSocketError] = useState(-1)
    const [socketConnected, setSocketConnected] = useState(false)
    const [updateAvailable, setUpdate] = useState(false)
    const [user, setUser] = useState<UserInterface>(userInitials)
    const [app, setApp] = useState<SettingsInterface>(settingsInitials)
    const [modInfo, setMod] = useState<ModInterface[]>(modInitials)
    const [themes, setThemes] = useState<ThemeInterface[]>(ThemeInitials)

    const [navigateTo, setNavigateTo] = useState<string | null>(null)
    const [navigateState, setNavigateState] = useState<ThemeInterface | null>(null)

    const [loading, setLoading] = useState(true)
    const socket = io(config.SOCKET_URL, {
        path: '/ws',
        autoConnect: false,
        auth: {
            token: getUserToken(),
        },
    })
    const [appInfo, setAppInfo] = useState<AppInfoInterface[]>([])
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
            path: '/extension',
            element: (
                <ErrorBoundary>
                    <ExtensionPage />
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
                        toast.error('Превышено количество попыток подключения.')
                        window.desktopEvents?.send('authStatus', false)
                        setLoading(false)
                        return false
                    }
                }

                const sendErrorAuthNotify = (message: string) => {
                    toast.error(message)
                    window.desktopEvents?.send('show-notification', {
                        title: 'Ошибка авторизации 😡',
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

                        window.desktopEvents?.send('authStatus', true)
                        return true
                    } else {
                        setLoading(false)
                        window.electron.store.delete('tokens.token')
                        await router.navigate('/', { replace: true })
                        setUser(userInitials)
                        sendErrorAuthNotify(
                            'Не удалось получить данные пользователя. Пожалуйста, войдите снова.',
                        )
                        window.desktopEvents?.send('authStatus', false)
                        return false
                    }
                } catch (e: any) {
                    if (e.networkError) {
                        if (retryCount > 0) {
                            notifyUserRetries(retryCount)
                            retryCount--
                            return false
                        } else {
                            toast.error('Сервер недоступен. Попробуйте позже.')
                            window.desktopEvents?.send('authStatus', false)
                            setLoading(false)
                            return false
                        }
                    } else if (e.graphQLErrors && e.graphQLErrors.length > 0) {
                        const isForbidden = e.graphQLErrors.some(
                            (error: any) => error.extensions?.code === 'FORBIDDEN',
                        )

                        if (isForbidden) {
                            sendErrorAuthNotify(
                                'Ваша сессия истекла. Пожалуйста, войдите снова.',
                            )
                            if (window.electron.store.has('tokens.token')) {
                                window.electron.store.delete('tokens.token')
                            }
                            await router.navigate('/', { replace: true })
                            setUser(userInitials)
                            window.desktopEvents?.send('authStatus', false)
                            return false
                        } else {
                            Sentry.captureException(e)
                            sendErrorAuthNotify(
                                'Ошибка авторизации. Пожалуйста, попробуйте снова.',
                            )
                            if (window.electron.store.has('tokens.token')) {
                                window.electron.store.delete('tokens.token')
                            }
                            await router.navigate('/', { replace: true })
                            setUser(userInitials)
                            window.desktopEvents?.send('authStatus', false)
                            return false
                        }
                    } else {
                        Sentry.captureException(e)
                        toast.error('Неизвестная ошибка авторизации.')
                        window.desktopEvents?.send('authStatus', false)
                        setLoading(false)
                        return false
                    }
                }
            } else {
                window.desktopEvents?.send('authStatus', false)
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
                        window.desktopEvents?.send('authStatus', false)
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
        toast.success('Соединение установлено')
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

    socket.on('connect_error', (err) => {
        console.log('Socket connect error: ' + err)
        setSocketError(1)
        setSocket(null)
        setSocketConnected(false)
    })
    socket.on('logout', async (err) => {
        await client.resetStore()
        setUser(userInitials)
        setSocketError(1)
        setSocket(null)
        setSocketConnected(false)
        await router.navigate('/', { replace: true })
    })

    useEffect(() => {
        if (socketError === 1 || socketError === 0) {
            toast.error('Сервер не доступен')
        } else if (socketConnected) {
            toast.success('Соединение восстановлено')
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
                console.log(currentApp.mod.version)
                console.log(!currentApp.mod.version)
                const info = (data.getMod as ModInterface[])
                    .filter(
                        (info) =>
                            !currentApp.mod.version ||
                            compareVersions(
                                info.modVersion,
                                currentApp.mod.version,
                            ) > 0,
                    )
                    .sort((a, b) => compareVersions(b.modVersion, a.modVersion))

                if (info.length > 0) {
                    setMod(info)
                } else {
                    console.log('Нет доступных обновлений')
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
                        const sortedAppInfos = data.appInfo.sort(
                            (a: any, b: any) => b.id - a.id,
                        )
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

            if (
                !user.badges.some((badge) => badge.type === 'supporter') &&
                !app.discordRpc.enableGithubButton
            ) {
                setApp({
                    ...app,
                    discordRpc: {
                        ...app.discordRpc,
                        enableGithubButton: true,
                    },
                })
                window.electron.store.set('discordRpc.enableGithubButton', true)
            }
            window.desktopEvents?.send('websocket-start')
            window.desktopEvents
                .invoke('getThemes')
                .then((fetchedThemes: ThemeInterface[]) => {
                    setThemes(fetchedThemes)
                })

            return () => {
                clearInterval(intervalId)
            }
        } else {
            router.navigate('/', { replace: true })
        }
    }, [user.id])

    const invokeFileEvent = async (
        eventType: string,
        filePath: string,
        data?: any,
    ) => {
        return await window.desktopEvents?.invoke(
            'file-event',
            eventType,
            filePath,
            data,
        )
    }

    useEffect(() => {
        const handleOpenTheme = (event: any, data: string) => {
            window.desktopEvents
                ?.invoke('getThemes')
                .then((fetchedThemes: ThemeInterface[]) => {
                    const foundTheme = fetchedThemes.find((t) => t.name === data)
                    if (foundTheme) {
                        setThemes(fetchedThemes)
                        setNavigateTo(`/extensionbeta/${foundTheme.name}`)
                        setNavigateState(foundTheme)
                    }
                })
                .catch((error) => console.error('Error getting themes:', error))
        }
        window.desktopEvents?.on('open-theme', handleOpenTheme)

        window.desktopEvents?.on('check-file-exists', (filePath) =>
            invokeFileEvent('check-file-exists', filePath),
        )
        window.desktopEvents?.on('read-file', (filePath) =>
            invokeFileEvent('read-file', filePath),
        )
        window.desktopEvents?.on('create-config-file', (filePath, defaultContent) =>
            invokeFileEvent('create-config-file', filePath, defaultContent),
        )
        window.desktopEvents?.on('write-file', (filePath, data) =>
            invokeFileEvent('write-file', filePath, data),
        )

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
                setApp((prevSettings) => ({
                    ...prevSettings,
                    discordRpc: {
                        ...prevSettings.discordRpc,
                        status: data,
                    },
                }))
            })
            window.desktopEvents?.invoke('getVersion').then((version: string) => {
                setApp((prevSettings) => ({
                    ...prevSettings,
                    info: {
                        ...prevSettings.info,
                        version: version,
                    },
                }))
            })
            window.desktopEvents?.on('check-update', (event, data) => {
                let toastId: string
                toastId = hotToast.loading('Проверка обновлений', {
                    style: {
                        background: '#292C36',
                        color: '#ffffff',
                        border: 'solid 1px #363944',
                        borderRadius: '8px',
                    },
                })
                if (data.updateAvailable) {
                    console.log(data)
                    window.desktopEvents?.on(
                        'download-update-progress',
                        (event, value) => {
                            toast.loading(
                                <>
                                    <span>Загрузка обновления</span>
                                    <b style={{ marginLeft: '.5em' }}>
                                        {Math.floor(value)}%
                                    </b>
                                </>,
                                {
                                    id: toastId,
                                },
                            )
                        },
                    )
                    window.desktopEvents?.once('download-update-cancelled', () =>
                        hotToast.dismiss(toastId),
                    )
                    window.desktopEvents?.once('download-update-failed', () =>
                        toast.error('Ошибка загрузки обновления', {
                            id: toastId,
                        }),
                    )
                    window.desktopEvents?.once('download-update-finished', () =>
                        toast.success('Обновление загружено', { id: toastId }),
                    )
                } else {
                    toast.error('Обновления не найдены', { id: toastId })
                }
            })
            const loadSettings = async () => {
                await fetchSettings(setApp)
            }
            loadSettings()
        }
    }, [])

    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
        ;(window as any).setToken = async (args: any) => {
            window.electron.store.set('tokens.token', args)
            await authorize()
        }
        ;(window as any).tests = async (args: any) => {
            console.log(app.mod)
        }
        ;(window as any).refreshThemes = async (args: any) => {
            window.desktopEvents
                .invoke('getThemes')
                .then((fetchedThemes: ThemeInterface[]) => {
                    setThemes(fetchedThemes)
                    router.navigate('/extensionbeta', { replace: true })
                })
        }
        ;(window as any).getModInfo = async (currentApp: SettingsInterface) => {
            await fetchModInfo(currentApp).then(() => {
                toast.success('Информация о моде обновлена')
            })
        }
    }
    return (
        <div className="app-wrapper">
            <Toaster />
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
                    setThemes,
                    themes,
                    setMod: setMod,
                    modInfo: modInfo,
                }}
            >
                <Player>
                    <SkeletonTheme baseColor="#1c1c22" highlightColor="#333">
                        <CssVarsProvider>
                            {loading ? (
                                <Preloader />
                            ) : (
                                <RouterProvider router={router} />
                            )}
                        </CssVarsProvider>
                    </SkeletonTheme>
                </Player>
            </UserContext.Provider>
        </div>
    )
}

const Player: React.FC<any> = ({ children }) => {
    const { user, app, socket, socketConnected } = useContext(UserContext)
    const [track, setTrack] = useState<Track>(trackInitials)

    useEffect(() => {
        if (user.id !== '-1') {
            ;(async () => {
                if (typeof window !== 'undefined') {
                    if (app.discordRpc.status) {
                        window.desktopEvents?.on('trackinfo', (event, data) => {
                            console.log(data)
                            let coverImg: any
                            if (data.track?.coverUri) {
                                coverImg = `https://${data.track.coverUri.replace('%%', '1000x1000')}`
                            }

                            const timecodes = data.timecodes ?? [0, 0]
                            setTrack((prevTrack) => ({
                                ...prevTrack,
                                status: data.status ?? '',
                                event: data.event,
                                speed: data.speed,
                                volume: data.volume,
                                url: data.url ?? '',
                                albumArt: coverImg,
                                trackSource: data.track?.trackSource,
                                timestamps: timecodes,
                                realId: data.track?.realId ?? '',
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
                                            data.track?.artists?.map(
                                                (artist: any) => ({
                                                    id: artist.id ?? null,
                                                    name:
                                                        artist.name ??
                                                        'Unknown Artist',
                                                    various: artist.various ?? false,
                                                    composer:
                                                        artist.composer ?? false,
                                                    available:
                                                        artist.available ?? false,
                                                    cover: {
                                                        type:
                                                            artist.cover?.type ??
                                                            null,
                                                        uri:
                                                            artist.cover?.uri ??
                                                            null,
                                                        prefix:
                                                            artist.cover?.prefix ??
                                                            null,
                                                    },
                                                    genres: artist.genres ?? [],
                                                    disclaimers:
                                                        artist.disclaimers ?? [],
                                                }),
                                            ) ?? [],
                                    })) ?? [],
                                coverUri: data.track?.coverUri ?? '',
                                ogImage: data.track?.ogImage ?? null,
                                lyricsAvailable: data.track?.lyricsAvailable ?? null,
                                type: data.track?.type ?? null,
                                rememberPosition:
                                    data.track?.rememberPosition ?? null,
                                trackSharingFlag:
                                    data.track?.trackSharingFlag ?? null,
                            }))
                        })
                    } else {
                        window.desktopEvents?.removeAllListeners('trackinfo')
                        setTrack(trackInitials)
                    }
                }
            })()
        } else {
            window.discordRpc.clearActivity()
        }
    }, [user.id, app.discordRpc.status])

    const getCoverImage = (track: Track): string => {
        return track.albumArt || track.coverUri || track.ogImage || ''
    }

    const getTrackStartTime = (track: Track): number => {
        return track.timestamps && track.timestamps.length > 0
            ? track.timestamps[0]
            : 0
    }

    const getTrackEndTime = (track: Track): number => {
        return track.timestamps && track.timestamps.length > 0
            ? track.timestamps[1]
            : 0
    }

    useEffect(() => {
        if (app.discordRpc.status && user.id !== '-1') {
            if (
                track.title === '' ||
                track.status === 'paused' ||
                (track.timestamps[0] === 0 && track.timestamps[1] === 0)
            ) {
                window.discordRpc.clearActivity()
            } else {
                const trackStartTime = getTrackStartTime(track)
                const trackEndTime = getTrackEndTime(track)
                const artistName = track.artists.map((x) => x.name).join(', ')

                const startTimestamp =
                    Math.floor(Date.now() / 1000) * 1000 -
                    Math.floor(Number(trackStartTime)) * 1000
                const endTimestamp =
                    startTimestamp + Math.floor(Number(trackEndTime)) * 1000

                const activity: any = {
                    type: 2,
                    startTimestamp,
                    endTimestamp,
                    largeImageKey: getCoverImage(track),
                    smallImageKey:
                        'https://cdn.discordapp.com/app-assets/984031241357647892/1180527644668862574.png',
                    smallImageText: app.info.version,
                    details:
                        app.discordRpc.details.length > 0
                            ? fixStrings(
                                  replaceParams(app.discordRpc.details, track),
                              )
                            : fixStrings(track.title),
                    state:
                        app.discordRpc.state.length > 0
                            ? fixStrings(replaceParams(app.discordRpc.state, track))
                            : fixStrings(artistName),
                }

                if (app.discordRpc.state.length > 0) {
                    activity.state =
                        fixStrings(replaceParams(app.discordRpc.state, track)) ||
                        'Музыка играет'
                }

                activity.buttons = []

                if (
                    track.trackSource !== 'UGC' &&
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
                    app.discordRpc.enableRpcButtonListen
                ) {
                    activity.buttons.push({
                        label: app.discordRpc.button
                            ? truncateLabel(app.discordRpc.button)
                            : '✌️ Open music file',
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

                if (!track.artists || track.artists.length === 0) {
                    setTrack((prevTrack: Track) => ({
                        ...prevTrack,
                        title: `${track.title} - Нейромузыка`,
                    }))
                    activity.details = fixStrings(`${track.title} - Нейромузыка`)
                }
                window.discordRpc.setActivity(activity)
            }
        }
    }, [app.settings, user, track, app.discordRpc])
    // useEffect(() => {
    //     console.log(track)
    //     if(socket && track.event === "trackChange" || track.event === "seek") {
    //         socket.emit('send_track', track)
    //     }
    // }, [track])
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
