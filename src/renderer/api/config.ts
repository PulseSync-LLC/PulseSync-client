export const isDev = true

export default {
    SERVER_URL: isDev ? 'http://localhost:4000' : '',
    SOCKET_URL: isDev
        ? 'http://localhost:1337/'
        : '',
    RETRY_INTERVAL_MS: 15000,
    MAX_RETRY_COUNT: 10,
}
