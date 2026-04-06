const OutgoingGatewayEvents = {
    USER_SETTINGS_UPDATE: 'user_settings_update',
    TRACK_PLAYED_ENOUGH: 'track_played_enough',
    SEND_TRACK: 'send_track',
    SEND_METRICS: 'send_metrics',
} as const

export type OutgoingGatewayEvent = (typeof OutgoingGatewayEvents)[keyof typeof OutgoingGatewayEvents]

export default OutgoingGatewayEvents
