export const isDev = true

export default {
    SERVER_URL: isDev ? 'http://91.243.98.92:4000' : 'https://api.pulsesync.dev',
    SOCKET_URL: isDev
        ? 'http://91.243.98.92:1337/'
        : 'https://socket.pulsesync.dev/',
    RETRY_INTERVAL_MS: 15000,
    MAX_RETRY_COUNT: 10,
}
