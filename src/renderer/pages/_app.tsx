import React, { useContext, useEffect, useState } from 'react'
import { createHashRouter, RouterProvider, useNavigate } from 'react-router-dom'
import UserMeQuery from '../api/queries/user/getMe.query'

import AuthPage from './auth'
import CallbackPage from './auth/callback'
import TrackInfoPage from './trackinfo'
import ExtensionPage from './extension'
import ExtensionBetaPage from './extensionbeta'
import ExtensionViewPage from './extensionbeta/route/extensionview'
import JointPage from './joint'

import hotToast, { Toaster } from 'react-hot-toast'
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
import TrackInterface from '../api/interfaces/track.interface'
import PlayerContext from '../api/context/player.context'
import apolloClient from '../api/apolloClient'
import SettingsInterface from '../api/interfaces/settings.interface'
import settingsInitials from '../api/initials/settings.initials'
import getUserToken from '../api/getUserToken'
import config from '../api/config'
import { AppInfoInterface } from '../api/interfaces/appinfo.interface'

import Preloader from '../components/preloader'
import { replaceParams } from '../utils/formatRpc'
import { fetchSettings } from '../api/settings'
import {
    checkInternetAccess,
    notifyUserRetries,
} from '../utils/utils'
import ThemeInterface from '../api/interfaces/theme.interface'
import userContext from '../api/context/user.context'
import ThemeInitials from '../api/initials/theme.initials'

function _app() {
    const [socketIo, setSocket] = useState<Socket | null>(null)
    const [socketError, setSocketError] = useState(-1)
    const [socketConnected, setSocketConnected] = useState(false)
    const [updateAvailable, setUpdate] = useState(false)
    const [user, setUser] = useState<UserInterface>(userInitials)
    const [app, setApp] = useState<SettingsInterface>(settingsInitials)
    const [themes, setThemes] = useState<ThemeInterface[]>(ThemeInitials)
    const [loading, setLoading] = useState(true)
    const socket = io(config.SOCKET_URL, {
        autoConnect: false,
        auth: {
            token: getUserToken(),
        },
    })
    const [appInfo, setAppInfo] = useState<AppInfoInterface[]>([])
    const router = createHashRouter([
        {
            path: '/',
            element: <AuthPage />,
        },
        {
            path: '/auth/callback',
            element: <CallbackPage />,
        },
        {
            path: '/trackinfo',
            element: <TrackInfoPage />,
        },
        {
            path: '/extension',
            element: <ExtensionPage />,
        },
        {
            path: '/extensionbeta',
            element: <ExtensionBetaPage />,
        },
        {
            path: '/extensionbeta/:contactId',
            element: <ExtensionViewPage />,
        },
        {
            path: '/joint',
            element: <JointPage />,
        },
    ])

    const authorize = async () => {
        let retryCount = config.MAX_RETRY_COUNT

        const attemptAuthorization = async (): Promise<boolean> => {
            const token = await getUserToken()
            console.log(token)

            if (token) {
                const isOnline = await checkInternetAccess()
                if (!isOnline) {
                    if (retryCount > 0) {
                        notifyUserRetries(retryCount)
                        retryCount--
                        return false
                    } else {
                        toast.error(
                            'Превышено количество попыток подключения.',
                        )
                        window.desktopEvents?.send('authStatus', false)
                        setLoading(false)
                        return false
                    }
                }

                const sendErrorAuthNotify = () => {
                    toast.error('Ошибка авторизации')
                    window.desktopEvents?.send('show-notification', {
                        title: 'Ошибка авторизации 😡',
                        body: 'Произошла ошибка при авторизации в программе',
                    })
                }

                try {
                    let res = await apolloClient.query({
                        query: UserMeQuery,
                        fetchPolicy: 'no-cache',
                    })

                    const { data } = res
                    if (data.getMe && data.getMe.id) {
                        setUser(data.getMe)

                        await router.navigate('/trackinfo', {
                            replace: true,
                        })

                        window.desktopEvents?.send('authStatus', true)
                        return true
                    } else {
                        setLoading(false)

                        window.electron.store.delete('tokens.token')
                        await router.navigate('/', {
                            replace: true,
                        })

                        setUser(userInitials)
                        sendErrorAuthNotify()

                        window.desktopEvents?.send('authStatus', false)
                        return false
                    }
                } catch (e) {
                    setLoading(false)
                    sendErrorAuthNotify()

                    if (window.electron.store.has('tokens.token')) {
                        window.electron.store.delete('tokens.token')
                    }
                    await router.navigate('/', {
                        replace: true,
                    })
                    setUser(userInitials)

                    window.desktopEvents?.send('authStatus', false)
                    return false
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

        window.desktopEvents
            ?.invoke('checkSleepMode')
            .then(async (res: boolean) => {
                if (!res) {
                    await retryAuthorization()
                }
            })
    }

    useEffect(() => {
        const handleMouseButton = (event: MouseEvent) => {
            if (event.button === 3) {
                event.preventDefault()
            }
            if (event.button === 4) {
                event.preventDefault()
            }
        }

        window.addEventListener('mouseup', handleMouseButton)

        return () => {
            window.removeEventListener('mouseup', handleMouseButton)
        }
    }, [])
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const checkAuthorization = async () => {
                await authorize()
            }

            if (user.id === '-1') {
                checkAuthorization()
            }
            // auth interval 15 minutes (10 * 60 * 1000)
            const intervalId = setInterval(checkAuthorization, 10 * 60 * 1000)

            return () => clearInterval(intervalId)
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

    socket.on('connect_error', err => {
        console.log('Socket connect error: ' + err)
        setSocketError(1)

        setSocket(null)
        setSocketConnected(false)
    })

    useEffect(() => {
        if (socketError === 1 || socketError === 0) {
            toast.error('Сервер не доступен')
        } else if (socketConnected) {
            toast.success('Соединение восстановлено')
        }
    }, [socketError])
    useEffect(() => {
        if (user.id !== '-1') {
            if (!socket.connected) {
                socket.connect()
            }
            window.desktopEvents?.send('updater-start')
            const fetchAppInfo = async () => {
                try {
                    const res = await fetch(
                        `${config.SERVER_URL}/api/v1/app/info`,
                    )
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
            if (
                !user.badges.some(badge => badge.type === 'supporter') &&
                app.discordRpc.enableGithubButton
            ) {
                setApp({
                    ...app,
                    discordRpc: {
                        ...app.discordRpc,
                        enableGithubButton: false,
                    },
                })
                window.electron.store.set(
                    'discordRpc.enableGithubButton',
                    false,
                )
            }
            window.desktopEvents
                .invoke('getThemes')
                .then((themes: ThemeInterface[]) => {
                    setThemes(themes)
                })
            window.desktopEvents?.on('open-theme', (event, data) => {
                window.desktopEvents
                    .invoke('getThemes')
                    .then(async (themes: ThemeInterface[]) => {
                        setThemes(themes)
                        console.log(themes.map((theme) => theme.name))
                        const theme = themes.find(theme => theme.name === data);
                        if (theme) {
                            router.navigate(`/extensionbeta/${theme.name}`, {
                                state: { theme }
                            }).then(r => {
                                console.log("Navigation success:", r);
                            }).catch(err => console.error("Navigation error:", err));
                        } else {
                            console.error(`Theme with name "${data}" not found`);
                        }

                    })
            })
        } else {
            router.navigate('/', {
                replace: true,
            })
        }
    }, [user.id])

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
            window.desktopEvents
                ?.invoke('getVersion')
                .then((version: string) => {
                    setApp(prevSettings => ({
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
                    window.desktopEvents?.once(
                        'download-update-cancelled',
                        () => hotToast.dismiss(toastId),
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
                    toast.error('Обновления не найдены', {
                        id: toastId,
                    })
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
                    themes
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
    const { user, app } = useContext(UserContext)
    const [track, setTrack] = useState<TrackInterface>(trackInitials)

    useEffect(() => {
        if (user.id !== '-1') {
            ;(async () => {
                if (typeof window !== 'undefined') {
                    if (app.discordRpc.status) {
                        window.desktopEvents?.on('trackinfo', (event, data) => {
                            setTrack(prevTrack => ({
                                ...prevTrack,
                                playerBarTitle: data.playerBarTitle,
                                artist: data.artist,
                                timecodes: data.timecodes,
                                requestImgTrack: data.requestImgTrack,
                                linkTitle: data.linkTitle,
                            }))
                        })
                        window.desktopEvents?.on(
                            'track_info',
                            (event, data) => {
                                setTrack(prevTrack => ({
                                    ...prevTrack,
                                    id: data.trackId,
                                    url: data.url,
                                }))
                            },
                        )
                    } else {
                        window.desktopEvents.removeListener(
                            'track-info',
                            setTrack,
                        )
                        setTrack(trackInitials)
                    }
                }
            })()
        } else {
            window.discordRpc.clearActivity()
        }
    }, [user.id, app.discordRpc.status])
    useEffect(() => {
        if (app.discordRpc.status && user.id !== '-1') {
            if (track.playerBarTitle === '' && track.artist === '') {
                const activity: any = {
                    details: 'AFK',
                    largeImageText: app.info.version,
                    largeImageKey:
                        'https://cdn.discordapp.com/app-assets/984031241357647892/1180527644668862574.png',
                }
                window.discordRpc.setActivity(activity)
            } else {
                const timeRange =
                    track.timecodes.length === 2
                        ? `${track.timecodes[0]} - ${track.timecodes[1]}`
                        : ''

                const details =
                    track.artist.length > 0
                        ? `${track.playerBarTitle} - ${track.artist}`
                        : track.playerBarTitle
                const activity: any = {
                    type: 2,
                    largeImageKey: track.requestImgTrack[1],
                    smallImageKey:
                        'https://cdn.discordapp.com/app-assets/984031241357647892/1180527644668862574.png',
                    smallImageText: app.info.version,
                    details:
                        app.discordRpc.details.length > 0
                            ? replaceParams(app.discordRpc.details, track)
                            : details,
                }
                if (app.discordRpc.state.length > 0) {
                    activity.state = replaceParams(app.discordRpc.state, track);
                } else if (timeRange) {
                    activity.state = timeRange;
                }
                activity.buttons = []
                if (app.discordRpc.enableRpcButtonListen && track.linkTitle) {
                    activity.buttons.push({
                        label: app.discordRpc.button
                            ? app.discordRpc.button
                            : '✌️ Open in Yandex Music',
                        url: `yandexmusic://album/${encodeURIComponent(track.linkTitle)}`,
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

                if (!track.artist && !timeRange) {
                    track.artist = 'Нейромузыка'
                    setTrack(prevTrack => ({
                        ...prevTrack,
                        artist: 'Нейромузыка',
                    }))
                    activity.details = `${track.playerBarTitle} - ${track.artist}`
                }

                window.discordRpc.setActivity(activity)
            }
        }
    }, [app.settings, user, track, app.discordRpc])
    return (
        <PlayerContext.Provider
            value={{
                currentTrack: track,
            }}
        >
            {children}
        </PlayerContext.Provider>
    )
}
export default _app
