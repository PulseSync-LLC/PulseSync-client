import React from 'react'
import ReactDOM from 'react-dom/client'
import Modal from 'react-modal'
import AppPage from './pages/_app'
import { Snowfall } from 'react-snowfall'
import ErrorBoundary from './components/errorBoundary/errorBoundary'
import { Provider } from 'react-redux'
import store from './api/store/store'

function App() {
    Modal.setAppElement('#root')
    ReactDOM.createRoot(document.getElementById('root')).render(
        <Provider store={store}>
            <ErrorBoundary>
                <Snowfall />
                <AppPage />
            </ErrorBoundary>
        </Provider>,
    )
}

App()
