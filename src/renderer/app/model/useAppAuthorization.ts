import { useCallback, useEffect, useRef, useState } from 'react'

import { CombinedGraphQLErrors, ServerError } from '@apollo/client'
import { useLazyQuery } from '@apollo/client/react'

import config from '@common/appConfig'
import { setRendererErrorTrackingUser } from '@app/errorTracking'
import UserMeQuery from '@entities/user/api/getMe.query'
import userInitials from '@entities/user/model/user.initials'
import { desktopApi } from '@shared/desktop/desktopApi'
import { clearCachedUserToken, getUserTokenAsync } from '@shared/lib/auth/getUserToken'
import { checkInternetAccess, notifyUserRetries } from '@shared/lib/utils'
import toast from '@shared/ui/toast'

import type { GetMeData, GetMeVars } from '@app/AppShell.types'
import type UserInterface from '@entities/user/model/user.interface'

type Params = {
    router: {
        navigate: (to: string, options?: any) => Promise<void> | void
        state?: {
            location?: {
                pathname?: string
            }
        }
    }
    setIsAppDeprecated: (value: boolean) => void
    setLoading: (value: boolean) => void
    setUser: React.Dispatch<React.SetStateAction<UserInterface>>
    tRef: React.MutableRefObject<(key: string, options?: any) => string>
    userId: string
}

export function useAppAuthorization({ router, setIsAppDeprecated, setLoading, setUser, tRef, userId }: Params) {
    const [tokenReady, setTokenReady] = useState(false)
    const [hasToken, setHasToken] = useState(false)
    const lastAuthStatusRef = useRef<string | null>(null)
    const mountedRef = useRef(true)
    const authorizationRef = useRef<{ token: string; controller: AbortController; promise: Promise<void> } | null>(null)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            authorizationRef.current?.controller.abort()
            authorizationRef.current = null
        }
    }, [])

    const [fetchMe, { loading: meLoading }] = useLazyQuery<GetMeData, GetMeVars>(UserMeQuery, {
        fetchPolicy: 'no-cache',
    })

    const shouldRedirectToHomeAfterAuth = useCallback(() => {
        const routerPath = router && 'state' in router ? router.state?.location?.pathname : undefined
        const rawHash = typeof window !== 'undefined' ? window.location?.hash || '' : ''
        const hashPath = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
        const path = routerPath || hashPath
        return path === '/auth' || path === '/auth/callback' || path === ''
    }, [router])

    const sendAuthStatus = useCallback((user?: Partial<UserInterface> | null) => {
        if (user?.id) {
            const statusKey = JSON.stringify({ id: user.id, username: user.username, email: user.email })
            if (lastAuthStatusRef.current === statusKey) return
            lastAuthStatusRef.current = statusKey
            setRendererErrorTrackingUser({ id: user.id, email: user.email })
            desktopApi.auth.setStatus({
                status: true,
                user: {
                    id: user.id as string,
                    username: user.username as string,
                    email: user.email as string,
                },
            })
            return
        }

        if (lastAuthStatusRef.current === 'signed-out') return
        lastAuthStatusRef.current = 'signed-out'
        setRendererErrorTrackingUser(null)
        desktopApi.auth.setStatus({ status: false })
    }, [])

    const redirectToAuth = useCallback(async () => {
        await desktopApi.auth.deleteToken()
        clearCachedUserToken()
        setHasToken(false)
        await router.navigate('/home', { replace: true })
        setUser(userInitials)
        sendAuthStatus(null)
    }, [router, sendAuthStatus, setUser, setHasToken])

    const authorize = useCallback(async () => {
        let token: string
        try {
            token = await getUserTokenAsync()
        } catch {
            if (mountedRef.current) {
                sendAuthStatus(null)
                setLoading(false)
            }
            return
        }
        if (!mountedRef.current) return
        if (authorizationRef.current?.token === token) return authorizationRef.current.promise

        authorizationRef.current?.controller.abort()
        const controller = new AbortController()
        const authorization = { token, controller, promise: Promise.resolve() }
        authorizationRef.current = authorization
        const isActive = () => mountedRef.current && !controller.signal.aborted
        const hasCurrentToken = async () => {
            const currentToken = await getUserTokenAsync()
            if (currentToken !== token) controller.abort()
            return isActive()
        }
        let retryCount = config.MAX_RETRY_COUNT

        const attemptAuthorization = async (): Promise<boolean> => {
            if (!(await hasCurrentToken())) return false

            const isOnline = await checkInternetAccess()
            if (!(await hasCurrentToken())) return false
            if (!isOnline) {
                if (retryCount > 0) {
                    notifyUserRetries(retryCount)
                    retryCount--
                    setLoading(false)
                    return true
                }

                toast.custom('error', tRef.current('common.takeBreakTitle'), tRef.current('common.tooManyAttempts'))
                sendAuthStatus(null)
                return false
            }

            const sendErrorAuthNotify = (message: string, title?: string) => {
                toast.custom('error', tRef.current('common.errorTitle'), message, undefined, undefined, 10000)
                desktopApi.system.showNotification({
                    title: tRef.current('auth.authErrorTitle', { title }),
                    body: message,
                })
            }

            try {
                const res = await fetchMe({
                    context: { queryDeduplication: false, fetchOptions: { signal: controller.signal } },
                })
                if (!(await hasCurrentToken())) return false
                const data = res.data as GetMeData | undefined

                if (data?.getMe && data.getMe.id) {
                    setUser(prev => ({ ...prev, ...data.getMe }) as UserInterface)
                    if (shouldRedirectToHomeAfterAuth()) {
                        await router.navigate('/home', { replace: true })
                    }
                    if (isActive()) sendAuthStatus(data.getMe)
                    return false
                }

                await redirectToAuth()
                sendErrorAuthNotify(tRef.current('auth.failedToFetchUser'))
                return false
            } catch (authorizationError: unknown) {
                if (!(await hasCurrentToken())) return false
                const err = authorizationError as unknown

                if ((ServerError as any)?.is?.(err) || (err as any)?.name === 'TypeError') {
                    if (retryCount > 0) {
                        notifyUserRetries(retryCount)
                        retryCount--
                        setLoading(false)
                        return true
                    }

                    toast.custom('error', tRef.current('common.pingPongTitle'), tRef.current('common.serverUnavailable'))
                    sendAuthStatus(null)
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
                            undefined,
                            undefined,
                            10000,
                        )
                        desktopApi.updates.start()
                        setIsAppDeprecated(true)
                        await redirectToAuth()
                        return false
                    }
                }

                toast.custom('error', tRef.current('auth.accessQuestionTitle'), tRef.current('auth.unknownAuthError'))
                sendAuthStatus(null)
                return false
            }
        }

        authorization.promise = (async () => {
            try {
                setHasToken(!!token)
                setTokenReady(true)
                if (!token) {
                    sendAuthStatus(null)
                    return
                }
                const isSleeping = await desktopApi.system.checkSleepMode()
                if (!isActive() || isSleeping) return

                while (isActive() && (await attemptAuthorization())) {
                    await new Promise<void>(resolve => {
                        const finish = () => {
                            clearTimeout(timer)
                            controller.signal.removeEventListener('abort', finish)
                            resolve()
                        }
                        const timer = setTimeout(finish, config.RETRY_INTERVAL_MS)
                        controller.signal.addEventListener('abort', finish, { once: true })
                        if (!isActive()) finish()
                    })
                }
            } catch {
                if (isActive()) {
                    toast.custom('error', tRef.current('auth.accessQuestionTitle'), tRef.current('auth.unknownAuthError'))
                    sendAuthStatus(null)
                }
            } finally {
                if (authorizationRef.current === authorization) {
                    authorizationRef.current = null
                    if (isActive()) setLoading(false)
                }
            }
        })()
        return authorization.promise
    }, [fetchMe, redirectToAuth, router, sendAuthStatus, setIsAppDeprecated, setLoading, setUser, shouldRedirectToHomeAfterAuth, tRef])

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

        const unsubscribeAuthSuccess = desktopApi.auth.onSuccess(handleAuthStatus)
        window.addEventListener('mouseup', handleMouseButton)

        return () => {
            clearInterval(intervalId)
            unsubscribeAuthSuccess()
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
