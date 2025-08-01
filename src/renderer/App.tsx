import React from 'react'
import ReactDOM from 'react-dom/client'
import Modal from 'react-modal'
import AppPage from './pages/_app'
import ErrorBoundary from './components/errorBoundary/errorBoundary'
import { Provider } from 'react-redux'
import store from './api/store/store'
import { ApolloProvider } from '@apollo/client'
import client from './api/apolloClient'

function App() {
    Modal.setAppElement('#root')
    ReactDOM.createRoot(document.getElementById('root')).render(
        <Provider store={store}>
            <ErrorBoundary>
                <ApolloProvider client={client}>
                    <AppPage />
                </ApolloProvider>
            </ErrorBoundary>
        </Provider>,
    )
}

App()
