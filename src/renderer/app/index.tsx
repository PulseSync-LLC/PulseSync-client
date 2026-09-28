import React from 'react'
import ReactDOM from 'react-dom/client'

import Modal from 'react-modal'

import App from '@app/App'
import { captureRendererException, initRendererErrorTracking } from '@app/errorTracking'

const rootElement = document.getElementById('root')
if (!rootElement) {
    throw new Error('Root element not found')
}

initRendererErrorTracking()

Modal.setAppElement('#root')
const root = ReactDOM.createRoot(rootElement, {
    onUncaughtError: error => captureRendererException(error, 'react_root'),
})
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
