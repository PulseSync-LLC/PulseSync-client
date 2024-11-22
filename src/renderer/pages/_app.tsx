import React, { useContext, useEffect, useState } from 'react'
import { createHashRouter, RouterProvider, useNavigate } from 'react-router-dom'
import UserMeQuery from '../api/queries/user/getMe.query'

import AuthPage from './auth'
import CallbackPage from './auth/callback'
import ExtensionPage from './extension'
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
import { checkInternetAccess, notifyUserRetries } from '../utils/utils'
import ThemeInterface from '../api/interfaces/theme.interface'
import userContext from '../api/context/user.context'
import ThemeInitials from '../api/initials/theme.initials'
import ErrorBoundary from '../components/errorBoundary'
import { PatcherInterface } from '../api/interfaces/patcher.interface'
import patcherInitials from '../api/initials/patcher.initials'
import GetPatcherQuery from '../api/queries/getPatcher.query'

function _app() {
    const [socketIo, setSocket] = useState<Socket | null>(null)
    const [socketError, setSocketError] = useState(-1)
    const [socketConnected, setSocketConnected] = useState(false)
    const [updateAvailable, setUpdate] = useState(false)
    const [user, setUser] = useState<UserInterface>(userInitials)
    const [app, setApp] = useState<SettingsInterface>(settingsInitials)
    const [patcherInfo, setPatcher] = useState<PatcherInterface[]>(patcherInitials)
    const [themes, setThemes] = useState<ThemeInterface[]>(ThemeInitials)

    const [navigateTo, setNavigateTo] = useState<string | null>(null)
    const [navigateState, setNavigateState] = useState<ThemeInterface | null>(
        null,
    )

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
            path: '/extension',
            element: (
                <ErrorBoundary>
                    <ExtensionPage />
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

                        await router.navigate('/extensionbeta', {
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
        if (typeof window !== 'undefined') {
            const checkAuthorization = async () => {
                await authorize()
            }

            if (user.id === '-1') {
                checkAuthorization()
            }
            // auth interval 15 minutes (10 * 60 * 1000)
            const intervalId = setInterval(checkAuthorization, 10 * 60 * 1000)
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
            const fetchPatcherInfo = async () => {
                try {
                    let res = await apolloClient.query({
                        query: GetPatcherQuery,
                        fetchPolicy: 'no-cache',
                    })
                    const { data } = res
                    if (data && data.getPatcher) {
                        setPatcher(data.getPatcher)
                    } else {
                        console.error('Invalid response format for getPatcher:', data)
                    }
                } catch (e) {
                    console.error('Failed to fetch patcher info:', e)
                }
            }

            // Вызов функции получения информации о патчере
            fetchPatcherInfo()
            const intervalId = setInterval(fetchPatcherInfo, 10 * 60 * 1000)

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
            return () => {
                clearInterval(intervalId)
            }
        } else {
            router.navigate('/', {
                replace: true,
            })
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
                .then((themes: ThemeInterface[]) => {
                    const theme = themes.find(t => t.name === data)
                    if (theme) {
                        setThemes(themes)
                        setNavigateTo(`/extensionbeta/${theme.name}`)
                        setNavigateState(theme)
                    }
                })
                .catch(error => console.error('Error getting themes:', error))
        }
        window.desktopEvents?.on('open-theme', handleOpenTheme)

        window.desktopEvents?.on('check-file-exists', filePath =>
            invokeFileEvent('check-file-exists', filePath),
        )
        window.desktopEvents?.on('read-file', filePath =>
            invokeFileEvent('read-file', filePath),
        )
        window.desktopEvents?.on(
            'create-config-file',
            (filePath, defaultContent) =>
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
                    themes,
                    setPatcher,
                    patcherInfo,
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
                                album: data.albums,
                                timecodes: data.timecodes,
                                requestImgTrack: data.requestImgTrack,
                                linkTitle: data.linkTitle,
                                status: data.status,
                                url: data.url,
                                id: data.id,
                            }))
                        })
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
            if ((track.playerBarTitle === '' && track.artist === '') || track.status == 'paused') {
                window.discordRpc.clearActivity()
            } else {
                const startTimestamp = Math.floor(Date.now()/1000)*1000 - Math.floor(Number(track.timecodes[0])) * 1000;
                const endTimestamp = startTimestamp + Math.floor(Number(track.timecodes[1])) * 1000;

                const details =
                    track.artist.length > 0
                        ? `${track.playerBarTitle} - ${track.artist}`
                        : track.playerBarTitle
                const activity: any = {
                    type: 2,
                    startTimestamp,
                    endTimestamp,
                    largeImageKey: track.requestImgTrack[0],
                    smallImageKey:
                        'https://cdn.discordapp.com/app-assets/984031241357647892/1180527644668862574.png',
                    smallImageText: app.info.version,
                    details:
                        app.discordRpc.details.length > 0
                            ? replaceParams(app.discordRpc.details, track)
                            : details,
                }
                if (app.discordRpc.state.length > 0) {
                    activity.state = replaceParams(app.discordRpc.state, track) || 'Музыка играет'
                } /* else if (timeRange) {
                    activity.state = timeRange
                } */
                activity.buttons = []
                if (app.discordRpc.enableRpcButtonListen && track.linkTitle) {
                    activity.buttons.push({
                        label: app.discordRpc.button
                            ? app.discordRpc.button
                            : '✌️ Open in Yandex Music',
                        url: `yandexmusic://album/${encodeURIComponent(track.linkTitle)}/track/${track.id}`,
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

                if (!track.artist) {
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
