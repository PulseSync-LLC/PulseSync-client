import React from 'react'
import AppPage from '@app/AppShell'
import ErrorBoundary from '@shared/ui/errorBoundary/errorBoundary'
import client from '@shared/api/apolloClient'
import { ApolloProvider } from '@apollo/client/react'
import ModalContainer from '@widgets/modalContainer/ModalContainer'
import { ModalProvider } from '@app/providers/modal'
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
