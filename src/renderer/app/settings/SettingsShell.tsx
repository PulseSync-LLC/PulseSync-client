import { createHashRouter, RouterProvider } from 'react-router'
import ErrorBoundary from '@shared/ui/errorBoundary/errorBoundary'

import SettingsPage from '@pages/settings'

function Settings() {
    const router = createHashRouter([
        {
            path: '/',
            element: (
                <ErrorBoundary>
                    <SettingsPage />
                </ErrorBoundary>
            ),
        },
    ])

    return (
        <div className="app-wrapper">
            <RouterProvider router={router} />
        </div>
    )
}

export default Settings
