import React from 'react'
import { Navigate, createHashRouter } from 'react-router'

import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import Dev from '@pages/dev'
import AuthPage from '@pages/auth'
import CallbackPage from '@pages/auth/callback'
import UsersPage from '@pages/users'
import ExtensionPage from '@pages/extension'
import JointPage from '@pages/joint'
import StorePage from '@pages/store'
import ProfilePage from '@pages/profile/[username]'
import ErrorBoundary from '@shared/ui/errorBoundary/errorBoundary'

function withErrorBoundary(node: React.ReactNode) {
    return <ErrorBoundary>{node}</ErrorBoundary>
}

function StoreRoute() {
    const { isExperimentEnabled, loading } = useExperiments()
    const storeEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.ClientExtensionStoreAccess, false)

    if (loading) {
        return null
    }

    if (!storeEnabled) {
        return <Navigate to="/" replace />
    }

    return <StorePage />
}

export function createAppRouter() {
    return createHashRouter([
        { path: '/', element: withErrorBoundary(<ExtensionPage />) },
        { path: '/auth', element: withErrorBoundary(<AuthPage />) },
        { path: '/dev', element: withErrorBoundary(<Dev />) },
        { path: '/auth/callback', element: withErrorBoundary(<CallbackPage />) },
        { path: '/users', element: withErrorBoundary(<UsersPage />) },
        { path: '/:contactId', element: withErrorBoundary(<ExtensionPage />) },
        { path: '/store', element: withErrorBoundary(<StoreRoute />) },
        { path: '/joint', element: withErrorBoundary(<JointPage />) },
        { path: '/profile/:username', element: withErrorBoundary(<ProfilePage />) },
    ])
}
