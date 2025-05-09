import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
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
    const [features, setFeatures] = useState<any>({})
    const [navigateTo, setNavigateTo] = useState<string | null>(null)
    const [navigateState, setNavigateState] = useState<AddonInterface | null>(null)
    const [loading, setLoading] = useState(true)
    const [musicInstalled, setMusicInstalled] = useState(false)
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
                        const isDeprecated = e.graphQLErrors.some((error: any) => error.extensions?.originalError?.error === 'DEPRECATED_VERSION')
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
        toast.custom('error', 'Внимание!', 'Ваша версия приложения устарела 😡 и скоро пректит работу. Пожалуйста, обновите приложение.')
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
                    .filter(info => !currentApp.mod.version || compareVersions(info.modVersion, currentApp.mod.version) > 0)
                    .sort((a, b) => compareVersions(b.modVersion, a.modVersion))

                if (info.length > 0) {
                    setMod(info)
                    if (currentApp.mod.installed && currentApp.mod.version && currentApp.mod.version < info[0].modVersion) {
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
            window.desktopEvents?.send('checkMusicInstall')
            window.desktopEvents?.invoke('getMusicStatus').then((status: any) => {
                setMusicInstalled(status)
            })
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
            const modCheckId = setInterval(fetchModInfo, 10 * 60 * 1000)

            window.desktopEvents?.send('REFRESH_MOD_INFO')
            window.desktopEvents.invoke('getAddons').then((fetchedAddons: AddonInterface[]) => {
                setAddons(fetchedAddons)
            })

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
        const handleOpenAddon = (event: any, data: string) => {
            window.desktopEvents
                ?.invoke('getAddons')
                .then((fetchedAddons: AddonInterface[]) => {
                    const foundAddon = fetchedAddons.find(t => t.name === data)
                    if (foundAddon) {
                        if (!foundAddon.type || (foundAddon.type !== 'theme' && foundAddon.type !== 'script')) {
                            toast.custom('error', 'Ошибка.', 'У аддона отсутвует поле type или оно некорректно', null, null, 15000)
                            return
                        }
                        setAddons(fetchedAddons)
                        setNavigateTo(`/extensionbeta/${foundAddon.name}`)
                        setNavigateState(foundAddon)
                    }
                })
                .catch(error => console.error('Error getting themes:', error))
        }
        window.desktopEvents?.on('open-addon', handleOpenAddon)

        window.desktopEvents?.on('check-file-exists', filePath => invokeFileEvent('check-file-exists', filePath))
        window.desktopEvents?.on('read-file', filePath => invokeFileEvent('read-file', filePath))
        window.desktopEvents?.on('create-config-file', (filePath, defaultContent) => invokeFileEvent('create-config-file', filePath, defaultContent))
        window.desktopEvents?.on('write-file', (filePath, data) => invokeFileEvent('write-file', filePath, data))

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
            window.desktopEvents.removeAllListeners('rpc-log')
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
            window.desktopEvents?.removeListener('rpc-log', onRpcLog)
            window.desktopEvents?.removeAllListeners('download-update-progress')
            window.desktopEvents?.removeAllListeners('download-update-failed')
            window.desktopEvents?.removeAllListeners('download-update-finished')
            window.desktopEvents?.removeAllListeners('check-update')
            window.desktopEvents?.removeAllListeners('discordRpcState')
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
                    musicInstalled,
                    setMusicInstalled,
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
                        console.log(data)
                        setTrack(prev => ({
                            ...prev,
                            coverUri: coverImg,
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
        return track.coverUri || 'https://cdn.discordapp.com/app-assets/984031241357647892/1180527644668862574.png'
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
                    largeImageKey: track.coverUri,
                    buttons: [],
                }
                if (app.discordRpc.showSmallIcon) {
                    activity.smallImageText = app.discordRpc.showVersionOrDevice
                        ? app.info.version
                        : ' on ' + (track.currentDevice?.info?.type ?? 'DESKTOP')
                    activity.smallImageKey = 'https://cdn.discordapp.com/app-assets/1124055337234858005/1250833449380614155.png'
                }
                if (track.status === 'paused' && app.discordRpc.displayPause) {
                    activity.smallImageText = 'Paused'
                    activity.smallImageKey = 'https://cdn.discordapp.com/app-assets/984031241357647892/1340838860963450930.png?size=256'
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
                        url: 'https://github.com/PulseSync-LLC/PulseSync-client/tree/dev',
                    })
                }
                if (activity.buttons.length === 0) {
                    delete activity.buttons
                }
                window.discordRpc.setActivity(activity)
                return
            } else {
                if (
                    track.title === '' || (track.status === 'paused' && !app.discordRpc.displayPause)
                ) {
                    window.discordRpc.clearActivity()
                    return
                } else {
                    let startTimestamp = Math.round(Date.now() - track.progress.position * 1000);
                    let endTimestamp = startTimestamp + track.durationMs;
                    const artistName = track.artists.map(x => x.name).join(', ')


                    const activity: any = {
                        type: 2,
                        largeImageKey: getCoverImage(track),
                        details:
                            app.discordRpc.details.length > 0
                                ? fixStrings(replaceParams(app.discordRpc.details, track))
                                : fixStrings(track.title || 'Unknown Track'),
                        state:
                            app.discordRpc.state.length > 0
                                ? fixStrings(replaceParams(app.discordRpc.state, track))
                                : fixStrings(artistName || 'Unknown Artist'),
                    }
                    if (app.discordRpc.showSmallIcon) {
                        activity.smallImageText = app.discordRpc.showVersionOrDevice
                            ? app.info.version
                            : ' on ' + (track.currentDevice?.info?.type ?? 'DESKTOP')
                        activity.smallImageKey = 'https://cdn.discordapp.com/app-assets/1124055337234858005/1250833449380614155.png'
                    }

                    if (track.status === 'paused' && app.discordRpc.displayPause) {
                        activity.smallImageText = 'Paused'
                        activity.smallImageKey = 'https://cdn.discordapp.com/app-assets/984031241357647892/1340838860963450930.png?size=256'
                        activity.details = fixStrings(track.title)
                        delete activity.startTimestamp
                        delete activity.endTimestamp
                    } else if (!track.id.includes('generative')) {
                        activity.startTimestamp = startTimestamp
                        activity.endTimestamp = endTimestamp
                    }

                    activity.buttons = []

                    if (track.trackSource !== 'UGC' && !track.id.includes('generative') && app.discordRpc.enableRpcButtonListen) {
                        const linkTitle = track.albums[0].id
                        activity.buttons.push({
                            label: app.discordRpc.button ? truncateLabel(app.discordRpc.button) : '✌️ Open in Yandex Music',
                            url: `yandexmusic://album/${encodeURIComponent(linkTitle)}/track/${track.realId}`,
                        })
                    } else if (track.trackSource === 'UGC' && !track.id.includes('generative') && app.discordRpc.enableRpcButtonListen) {
                        activity.buttons.push({
                            label: app.discordRpc.button ? truncateLabel(app.discordRpc.button) : '✌️ Open music file',
                            url: track.url,
                        })
                    }

                    if (app.discordRpc.enableGithubButton) {
                        activity.buttons.push({
                            label: '♡ PulseSync Project',
                            url: `https://github.com/PulseSync-LLC/PulseSync-client/tree/dev`,
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

                        if (track.coverUri.includes('%%')) {
                            activity.largeImageKey = `https://${track.coverUri.replace('%%', 'orig')}`
                        }

                        delete activity.state
                    }
                    window.discordRpc.setActivity(activity)
                }
            }
        }
    }, [app.settings, user, track, app.discordRpc])
    useEffect(() => {
        if (socket) {
            if (features.sendTrack && track.title !== '' && track.sourceType !== 'ynison') {
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
        }
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
