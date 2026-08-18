import './i18n'

import React from 'react'

import { ApolloProvider } from '@apollo/client/react'
import { Toaster } from 'react-hot-toast'

import AppPage from '@app/AppShell'
import { ModalProvider } from '@app/providers/modal'
import BrowserDownloadBanner from '@widgets/browserDownloadBanner'
import ModalContainer from '@widgets/modalContainer/ModalContainer'
import client from '@shared/api/apolloClient'
import ErrorBoundary from '@shared/ui/errorBoundary/errorBoundary'

function App() {
    if (!window.pulsesyncDesktop) {
        return <BrowserDownloadBanner />
    }

    return (
        <>
            <Toaster
                position="top-center"
                reverseOrder={false}
                containerStyle={{
                    zIndex: 100050,
                }}
                toastOptions={{
                    style: {
                        zIndex: 100050,
                    },
                }}
            />
            <ErrorBoundary>
                <ApolloProvider client={client}>
                    <ModalProvider>
                        <ModalContainer />
                        <AppPage />
                    </ModalProvider>
                </ApolloProvider>
            </ErrorBoundary>
        </>
    )
}

export default App
