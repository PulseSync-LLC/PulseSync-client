const IncomingGatewayEvents = {
    DEPRECATED_VERSION: 'deprecated_version',
    ERROR_MESSAGE: 'error_message',
    LOGOUT: 'logout',
    USER_UPDATE: 'user_update',
    SUBSCRIPTION_UPDATE: 'subscription_update',
    ACHIEVEMENTS_UPDATE: 'achievements_update',
    NOTIFICATION_CREATED: 'notification_created',
    NOTIFICATION_READ: 'notification_read',
    NOTIFICATIONS_READ_ALL: 'notifications_read_all',
} as const

export type IncomingGatewayEvent = (typeof IncomingGatewayEvents)[keyof typeof IncomingGatewayEvents]

export default IncomingGatewayEvents
