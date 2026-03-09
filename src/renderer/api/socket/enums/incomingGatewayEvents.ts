const IncomingGatewayEvents = {
    FEATURE_TOGGLES: 'feature_toggles',
    DEPRECATED_VERSION: 'deprecated_version',
    UPDATE_FEATURES_ACK: 'update_features_ack',
    ERROR_MESSAGE: 'error_message',
    LOGOUT: 'logout',
    USER_UPDATE: 'user_update',
    SUBSCRIPTION_UPDATE: 'subscription_update',
    ACHIEVEMENTS_UPDATE: 'achievements_update',
} as const

export type IncomingGatewayEvent = (typeof IncomingGatewayEvents)[keyof typeof IncomingGatewayEvents]

export default IncomingGatewayEvents
