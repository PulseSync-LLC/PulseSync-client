import React from 'react'
import ReactDOM from 'react-dom/client'
import Modal from 'react-modal'
import ErrorBoundary from './components/errorBoundary/errorBoundary'
import SettingsPage from './pages/_settings'

function Settings() {
    Modal.setAppElement('#root')
    ReactDOM.createRoot(document.getElementById('root')).render(
        <ErrorBoundary>
            <SettingsPage />
        </ErrorBoundary>,
    )
}

Settings()
