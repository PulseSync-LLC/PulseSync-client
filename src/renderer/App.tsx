// src/renderer/index.tsx или renderer.ts (или любой основной файл, где вы поднимаете React):
import React from 'react'
import ReactDOM from 'react-dom/client'
import Modal from 'react-modal'
import { ApolloProvider } from '@apollo/client'
import apolloClient from './api/apolloClient'
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
