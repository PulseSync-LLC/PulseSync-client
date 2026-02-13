const OutgoingSocketEvents = {
    GATEWAY: 'gw',
} as const

export type OutgoingSocketEvent = (typeof OutgoingSocketEvents)[keyof typeof OutgoingSocketEvents]

export default OutgoingSocketEvents
