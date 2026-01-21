import '../renderer/Settings'
import '../styles/globals.css'
import * as Sentry from '@sentry/electron/renderer'

Sentry.init({
    attachStacktrace: true,
    integrations: [Sentry.browserTracingIntegration(), Sentry.browserProfilingIntegration()],
    tracePropagationTargets: ['127.0.0.1', 'localhost', /^https:\/\/ru-node-1\.pulsesync\.dev/],
})
