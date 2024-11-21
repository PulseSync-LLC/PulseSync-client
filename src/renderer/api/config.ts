export const isDev = false

export default {
    SERVER_URL: isDev ? 'http://localhost:4000' : 'https://api.pulsesync.dev',
    SOCKET_URL: isDev
        ? 'http://localhost:1337/'
        : 'https://socket.pulsesync.dev/',
    RETRY_INTERVAL_MS: 15000,
    MAX_RETRY_COUNT: 10,
}
