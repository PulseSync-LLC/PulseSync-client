import React from 'react'
import ReactDOM from 'react-dom/client'
import Modal from 'react-modal'

import AppPage from './pages/_app'
import ErrorBoundary from './components/errorBoundary'
import { Snowfall } from 'react-snowfall'

function App() {
    Modal.setAppElement('#root')
    ReactDOM.createRoot(document.getElementById('root')).render(
        <ErrorBoundary>
            <Snowfall />
            <AppPage />
        </ErrorBoundary>,
    )
}

App()
