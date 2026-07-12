import React from 'react'
import AppPage from '@app/AppShell'
import ErrorBoundary from '@shared/ui/errorBoundary/errorBoundary'
import client from '@shared/api/apolloClient'
import { ApolloProvider } from '@apollo/client/react'
import ModalContainer from '@widgets/modalContainer/ModalContainer'
import { ModalProvider } from '@app/providers/modal'
import BrowserDownloadBanner from '@widgets/browserDownloadBanner'
import './i18n'

function App() {
    if (!window.pulsesyncDesktop) {
        return <BrowserDownloadBanner />
    }

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
