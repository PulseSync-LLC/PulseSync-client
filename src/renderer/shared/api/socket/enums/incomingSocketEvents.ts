const IncomingSocketEvents = {
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    CONNECT_ERROR: 'connect_error',
    GATEWAY: 'gw',
    RECONNECT_ATTEMPT: 'reconnect_attempt',
    RECONNECT: 'reconnect',
} as const

export type IncomingSocketEvent = (typeof IncomingSocketEvents)[keyof typeof IncomingSocketEvents]

export default IncomingSocketEvents
