import { createNotificationPresenter } from '@common/notificationPresentation'
import { t } from '@app/i18n'

export type { NotificationPresentation, NotificationTone } from '@common/notificationPresentation'

export const getNotificationPresentation = createNotificationPresenter(t)
