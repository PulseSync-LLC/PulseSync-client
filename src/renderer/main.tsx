import React from 'react'
import ReactDOM from 'react-dom/client'
import Modal from 'react-modal'
import App from './App'

const rootElement = document.getElementById('root')
if (!rootElement) {
    throw new Error('Root element not found')
}

Modal.setAppElement('#root')
const root = ReactDOM.createRoot(rootElement)
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
