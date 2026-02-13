export const isDev = false
export const isDevmark = true
export const branch = "beta"

const PORT = '2007'
const MAIN_PORT = 2007

const config = {
    PORT,
    CLIENT_ID: '1270726237605855395',
    ENG_CLIENT_ID: '1270726237605855395',
    RU_CLIENT_ID: '1290778445370097674',
    RESERVE_CLIENT_ID: '1256145977056821248',
    UPDATE_URL: 'https://s3.pulsesync.dev',
    SERVER_URL: isDev ? 'http://localhost:4000' : 'https://ru-node-1.pulsesync.dev',
    WEBSITE_URL: isDev ? 'http://localhost:3100' : 'https://pulsesync.dev',
    S3_URL: 'https://s3.pulsesync.dev',
    SOCKET_URL: isDev ? 'http://localhost:1337/' : 'https://ru-node-1.pulsesync.dev/',
    RETRY_INTERVAL_MS: 15000,
    MAX_RETRY_COUNT: 15,
    MAIN_PORT,
}

export default config
