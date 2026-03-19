import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { CombinedGraphQLErrors, ServerError } from '@apollo/client'

import UserMeQuery from '@entities/user/api/getMe.query'
import UserInterface from '@entities/user/model/user.interface'
import userInitials from '@entities/user/model/user.initials'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'
import toast from '@shared/ui/toast'
import getUserToken from '@shared/lib/auth/getUserToken'
import config from '@common/appConfig'
import { checkInternetAccess, notifyUserRetries } from '@shared/lib/utils'
import type { GetMeData, GetMeVars } from '@app/AppShell.types'

type Params = {
    router: { navigate: (to: string, options?: any) => Promise<void> | void }
    setIsAppDeprecated: (value: boolean) => void
    setLoading: (value: boolean) => void
    setUser: React.Dispatch<React.SetStateAction<UserInterface>>
    tRef: React.MutableRefObject<(key: string, options?: any) => string>
    userId: string
}

export function useAppAuthorization({ router, setIsAppDeprecated, setLoading, setUser, tRef, userId }: Params) {
    const [tokenReady, setTokenReady] = useState(false)
    const [hasToken, setHasToken] = useState(false)

    useEffect(() => {
        let mounted = true
        const token = getUserToken()
        if (mounted) {
            setHasToken(!!token)
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

    const shouldRedirectToHomeAfterAuth = useCallback(() => {
        if (typeof window === 'undefined') return false
        const rawHash = window.location?.hash || ''
        const path = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
        return path === '/auth' || path === '/auth/callback' || path === ''
    }, [])

    const sendAuthStatus = useCallback((user?: Partial<UserInterface> | null) => {
        if (user?.id) {
            window.desktopEvents?.send(MainEvents.AUTH_STATUS, {
                status: true,
                user: {
                    id: user.id as string,
                    username: user.username as string,
                    email: user.email as string,
                },
            })
            return
        }

        window.desktopEvents?.send(MainEvents.AUTH_STATUS, { status: false })
    }, [])

    const redirectToAuth = useCallback(async () => {
        window.electron.store.delete('tokens.token')
        await router.navigate('/auth', { replace: true })
        setUser(userInitials)
        sendAuthStatus(null)
    }, [router, sendAuthStatus, setUser])

    useEffect(() => {
        if (!meData || !tokenReady) return

        if (meData.getMe && meData.getMe.id) {
            setUser(prev => ({ ...prev, ...meData.getMe }) as UserInterface)
            ;(async () => {
                if (shouldRedirectToHomeAfterAuth()) {
                    await router.navigate('/', { replace: true })
                }
                sendAuthStatus(meData.getMe)
                setLoading(false)
            })()
            return
        }

        setLoading(false)
        ;(async () => {
            await redirectToAuth()
        })()
        toast.custom('error', tRef.current('common.errorTitle'), tRef.current('auth.failedToFetchUser'), null, null, 10000)
    }, [meData, redirectToAuth, router, sendAuthStatus, setLoading, setUser, shouldRedirectToHomeAfterAuth, tRef, tokenReady])

    useEffect(() => {
        if (!meError) return

        const message = meError?.message || tRef.current('auth.unknownAuthError')
        if (CombinedGraphQLErrors.is(meError)) {
            const isDeprecated = meError.errors?.some((err: any) => err.extensions?.originalError?.error === 'DEPRECATED_VERSION')
            const isForbidden = meError.errors?.some((err: any) => err.extensions?.code === 'FORBIDDEN')

            if (isForbidden) {
                toast.custom('error', tRef.current('common.errorTitle'), tRef.current('auth.sessionExpired'), null, null, 10000)
                ;(async () => {
                    await redirectToAuth()
                })()
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
                setIsAppDeprecated(true)
                ;(async () => {
                    await redirectToAuth()
                })()
                setLoading(false)
                return
            }
        }

        toast.custom('error', tRef.current('auth.accessQuestionTitle'), message)
        sendAuthStatus(null)
        setLoading(false)
    }, [meError, redirectToAuth, sendAuthStatus, setIsAppDeprecated, setLoading, tRef])

    const authorize = useCallback(async () => {
        let retryCount = config.MAX_RETRY_COUNT

        const attemptAuthorization = async (): Promise<boolean> => {
            const token = getUserToken()

            if (!token) {
                sendAuthStatus(null)
                setLoading(false)
                return false
            }

            const isOnline = await checkInternetAccess()
            if (!isOnline) {
                if (retryCount > 0) {
                    notifyUserRetries(retryCount)
                    retryCount--
                    return false
                }

                toast.custom('error', tRef.current('common.takeBreakTitle'), tRef.current('common.tooManyAttempts'))
                sendAuthStatus(null)
                setLoading(false)
                return false
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
                    if (shouldRedirectToHomeAfterAuth()) {
                        await router.navigate('/', { replace: true })
                    }
                    sendAuthStatus(data.getMe)
                    return true
                }

                setLoading(false)
                await redirectToAuth()
                sendErrorAuthNotify(tRef.current('auth.failedToFetchUser'))
                return false
            } catch (authorizationError: unknown) {
                const err = authorizationError as unknown

                if ((ServerError as any)?.is?.(err) || (err as any)?.name === 'TypeError') {
                    if (retryCount > 0) {
                        notifyUserRetries(retryCount)
                        retryCount--
                        return false
                    }

                    toast.custom('error', tRef.current('common.pingPongTitle'), tRef.current('common.serverUnavailable'))
                    sendAuthStatus(null)
                    setLoading(false)
                    return false
                }

                if (CombinedGraphQLErrors.is(err)) {
                    const errors = (err as InstanceType<typeof CombinedGraphQLErrors>).errors || []
                    const isDeprecated = errors.some((error: any) => error.extensions?.originalError?.error === 'DEPRECATED_VERSION')
                    const isForbidden = errors.some((error: any) => error.extensions?.code === 'FORBIDDEN')

                    if (isForbidden) {
                        toast.custom('error', tRef.current('auth.sessionExpiredTitle'), tRef.current('auth.pleaseLoginAgain'))
                        await redirectToAuth()
                        return false
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
                        setIsAppDeprecated(true)
                        await redirectToAuth()
                        return false
                    }
                }

                toast.custom('error', tRef.current('auth.accessQuestionTitle'), tRef.current('auth.unknownAuthError'))
                sendAuthStatus(null)
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
                        sendAuthStatus(null)
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
    }, [redirectToAuth, refetchMe, router, sendAuthStatus, setIsAppDeprecated, setLoading, setUser, shouldRedirectToHomeAfterAuth, tRef])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const checkAuthorization = async () => {
            await authorize()
        }

        if (userId === '-1') {
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

        const handleAuthStatus = async () => {
            await authorize()
        }

        window.desktopEvents?.on(RendererEvents.AUTH_SUCCESS, handleAuthStatus)
        window.addEventListener('mouseup', handleMouseButton)

        return () => {
            clearInterval(intervalId)
            window.desktopEvents?.removeAllListeners(RendererEvents.AUTH_SUCCESS)
            window.removeEventListener('mouseup', handleMouseButton)
        }
    }, [authorize, userId])

    return {
        authorize,
        hasToken,
        meLoading,
        setHasToken,
        setTokenReady,
        tokenReady,
    }
}
