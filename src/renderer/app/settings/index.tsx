import React from 'react'
import ReactDOM from 'react-dom/client'
import Modal from 'react-modal'
import ErrorBoundary from '@shared/ui/errorBoundary/errorBoundary'
import SettingsPage from '@app/settings/SettingsShell'

function Settings() {
    Modal.setAppElement('#root')
    ReactDOM.createRoot(document.getElementById('root')).render(
        <ErrorBoundary>
            <SettingsPage />
        </ErrorBoundary>,
    )
}

Settings()
