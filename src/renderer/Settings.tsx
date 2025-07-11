import React from 'react'
import ReactDOM from 'react-dom/client'
import Modal from 'react-modal'
import ErrorBoundary from './components/errorBoundary/errorBoundary'
import { Provider } from 'react-redux'
import store from './api/store/store'
import SettingsPage from './pages/_settings'

function Settings() {
    Modal.setAppElement('#root')
    ReactDOM.createRoot(document.getElementById('root')).render(
        <Provider store={store}>
            <ErrorBoundary>
                    <SettingsPage />
            </ErrorBoundary>
        </Provider>,
    )
}

Settings()