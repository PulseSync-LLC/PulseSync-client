import React from 'react'
import AppPage from './pages/_app'
import ErrorBoundary from './components/errorBoundary/errorBoundary'
import client from './api/apolloClient'
import { ApolloProvider } from '@apollo/client/react'
import ModalContainer from './components/modalContainer/ModalContainer'
import { ModalProvider } from './api/context/modal'
import './i18n'

function App() {
    return (
        <ErrorBoundary>
            <ApolloProvider client={client}>
                <ModalProvider>
                    <ModalContainer />
                    <AppPage />
                </ModalProvider>
            </ApolloProvider>
        </ErrorBoundary>
    )
}

export default App
