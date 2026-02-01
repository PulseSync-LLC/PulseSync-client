import React from 'react'
import AppPage from './pages/_app'
import ErrorBoundary from './components/errorBoundary/errorBoundary'
import { Provider } from 'react-redux'
import store from './api/store/store'
import client from './api/apolloClient'
import { ApolloProvider } from '@apollo/client/react'
import ModalContainer from './components/modalContainer/ModalContainer'
import './i18n'

function App() {
    return (
        <Provider store={store}>
            <ErrorBoundary>
                <ApolloProvider client={client}>
                    <ModalContainer />
                    <AppPage />
                </ApolloProvider>
            </ErrorBoundary>
        </Provider>
    )
}

export default App
