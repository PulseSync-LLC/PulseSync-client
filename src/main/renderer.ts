import '../renderer/App'
import '../../static/styles/globals.css'
import * as Sentry from '@sentry/electron/renderer'

Sentry.init({
    dsn: 'https://6aaeb7f8130ebacaad9f8535d0c77aa8@o4507369806954496.ingest.de.sentry.io/4507369809182800',
    attachStacktrace: true,
    integrations: [
        Sentry.replayIntegration({
            maskAllText: false,
            blockAllMedia: false,
            networkDetailAllowUrls: ['https://ru-node-1.pulsesync.dev/graphql'],
            networkRequestHeaders: ['X-Sentry-Integration'],
            networkResponseHeaders: ['X-Sentry-Integration'],
        }),
        Sentry.browserTracingIntegration(),
        Sentry.browserProfilingIntegration(),
    ],
    replaysSessionSampleRate: 1.0,
    replaysOnErrorSampleRate: 1.0,
    profilesSampleRate: 1.0,
    tracePropagationTargets: [
        '127.0.0.1',
        'localhost',
        /^https:\/\/api\.pulsesync\.dev/,
    ],
})