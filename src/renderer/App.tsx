import React from 'react'
import ReactDOM from 'react-dom/client'
import Modal from 'react-modal'
import AppPage from './pages/_app'
import { Snowfall } from 'react-snowfall'
import ErrorBoundary from './components/errorBoundary/errorBoundary'

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
