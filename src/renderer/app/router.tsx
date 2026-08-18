import React, { lazy, Suspense, useContext } from 'react'

import { createHashRouter,Navigate } from 'react-router'

import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import HomePage from '@pages/home'
import Preloader from '@widgets/preloader'
import UserContext from '@entities/user/model/context'
import ErrorBoundary from '@shared/ui/errorBoundary/errorBoundary'

const Dev = lazy(() => import('@pages/dev'))
const AuthPage = lazy(() => import('@pages/auth'))
const CallbackPage = lazy(() => import('@pages/auth/callback'))
const UsersPage = lazy(() => import('@pages/users'))
const ExtensionPage = lazy(() => import('@pages/extension'))
const JointPage = lazy(() => import('@pages/joint'))
const StorePage = lazy(() => import('@pages/store'))

function withErrorBoundary(node: React.ReactNode) {
    return (
        <ErrorBoundary>
            <Suspense fallback={<Preloader />}>{node}</Suspense>
        </ErrorBoundary>
    )
}

function RequireAuthorized({ children }: { children: React.ReactNode }) {
    const { isAutonomousMode } = useContext(UserContext)

    if (isAutonomousMode) {
        return <Navigate to="/home" replace />
    }

    return <>{children}</>
}

function StoreRoute() {
    const { isAutonomousMode } = useContext(UserContext)
    const { isExperimentEnabled, loading } = useExperiments()
    const storeEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.ClientExtensionStoreAccess, false)

    if (loading) {
        return null
    }

    if (isAutonomousMode || !storeEnabled) {
        return <Navigate to="/home" replace />
    }

    return <StorePage />
}

function UsersRoute() {
    const { isAutonomousMode } = useContext(UserContext)
    const { isExperimentEnabled, loading } = useExperiments()
    const usersPageEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.ClientUsersPageAccess, false)

    if (loading) {
        return null
    }

    if (isAutonomousMode || !usersPageEnabled) {
        return <Navigate to="/home" replace />
    }

    return <UsersPage />
}

export function createAppRouter() {
    return createHashRouter([
        { path: '/', element: <Navigate to="/home" replace /> },
        { path: '/home', element: withErrorBoundary(<HomePage />) },
        {
            path: '/extensions',
            element: withErrorBoundary(
                <RequireAuthorized>
                    <ExtensionPage />
                </RequireAuthorized>,
            ),
        },
        { path: '/auth', element: withErrorBoundary(<AuthPage />) },
        { path: '/dev', element: withErrorBoundary(<Dev />) },
        { path: '/auth/callback', element: withErrorBoundary(<CallbackPage />) },
        { path: '/users', element: withErrorBoundary(<UsersRoute />) },
        {
            path: '/:contactId',
            element: withErrorBoundary(
                <RequireAuthorized>
                    <ExtensionPage />
                </RequireAuthorized>,
            ),
        },
        { path: '/store', element: withErrorBoundary(<StoreRoute />) },
        { path: '/joint', element: withErrorBoundary(<JointPage />) },
    ])
}
