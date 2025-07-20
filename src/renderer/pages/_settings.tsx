import { createHashRouter, RouterProvider } from 'react-router'
import Layout from '../components/layout'
import Container from '../components/container'
import ErrorBoundary from '../components/errorBoundary/errorBoundary'

import * as styles from '../../../../static/styles/page/index.module.scss'
import SettingsPage from './settings'

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
