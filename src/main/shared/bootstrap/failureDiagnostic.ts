import { randomBytes } from 'node:crypto'

import * as Sentry from '@sentry/electron/main'

import { captureMainException } from '../errorTracking'
import logger from '../logger'

import type { BootstrapUiDiagnostic } from '@common/types/bootstrapEvents'

export function captureBootstrapFailure(error: unknown, code: string, source: string, tags: Record<string, string> = {}): BootstrapUiDiagnostic {
    const reference = randomBytes(4).toString('hex').toUpperCase()
    logger.main.error('PulseSync startup failure', { code, reference, source, error })
    try {
        Sentry.withScope(scope => {
            scope.setTags({
                ...tags,
                'launch.failure_code': code,
                'launch.failure_ref': reference,
            })
            captureMainException(error, source)
        })
    } catch (trackingError) {
        logger.main.warn('Failed to capture startup diagnostics', { code, reference, error: trackingError })
    }
    return { code, reference }
}
