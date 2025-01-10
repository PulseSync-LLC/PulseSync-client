import '../renderer/App'
import '../../static/styles/globals.css'
import * as Sentry from '@sentry/electron/renderer'

Sentry.init({
    dsn: 'https://6aaeb7f8130ebacaad9f8535d0c77aa8@o4507369806954496.ingest.de.sentry.io/4507369809182800',
    attachStacktrace: true,
    integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.browserProfilingIntegration(),
    ],
    tracePropagationTargets: [
        '127.0.0.1',
        'localhost',
        /^https:\/\/ru-node-1\.pulsesync\.dev/,
    ],
})
