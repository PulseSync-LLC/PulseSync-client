export type RequestedManifestSource = 'backend' | 'github' | 'direct'
export type BootstrapperArtifactKey = 'host' | 'bootstrapper' | `module:${string}`
export type RustUpdateStage = 'resolving-source' | 'checking' | 'downloading' | 'planning' | 'preparing' | 'prepared' | 'up-to-date' | 'blocked'

export type RustUpdateProgressEventV1 = {
    schemaVersion: 1
    event: 'stage' | 'artifact-progress'
    stage: RustUpdateStage
    message: string
    artifactKey?: BootstrapperArtifactKey
    artifactIndex?: number
    artifactCount?: number
    bytesRead?: number
    bytesTotal?: number
    path?: string
}

export type RustHandoffArmedEventV1 = {
    schemaVersion: 1
    event: 'handoff-armed'
    handoffId: string
    activeLeaseId: string
    waitingForPid: number
    rustPid: number
}

export type UpdateErrorV1 = {
    schemaVersion: 1
    command: string
    state: 'error'
    error: {
        code: string
        phase:
            | 'validate-input'
            | 'lock'
            | 'resolve-source'
            | 'fetch-manifest'
            | 'validate-manifest'
            | 'decide'
            | 'download'
            | 'plan'
            | 'prepare'
            | 'discard'
            | 'handoff'
        message: string
        retryable: boolean
        safeToContinue: boolean
    }
}

export type ActiveAppLeaseV1 = {
    schemaVersion: 1
    leaseId: string
    state: 'active' | 'handoff-armed'
    pid: number
    processStartId: string
    executable: string
    launchProofId: string
    launchProofKind: 'reservation' | 'handoff' | 'recovery'
    inboxId: string
    inboxGeneration: number
    inheritedHandoffId?: string
    inheritedFromLeaseId?: string
    handoff?: { id: string; rustPid: number; rustProcessStartId: string; armedAt: string }
}

export type RustBlockV1 = {
    code: string
    retryable: boolean
    safeToContinue: boolean
    checkIds?: string[]
}

export type ClaimActiveAppResultV1 =
    | { schemaVersion: 1; state: 'claimed'; lease: ActiveAppLeaseV1; adoptedLaunchReservation: boolean }
    | { schemaVersion: 1; state: 'blocked'; block: RustBlockV1 }

export type UpdateDecisionV1 = {
    reason: 'update-available' | 'up-to-date' | 'missing-dist-artifacts' | 'invalid-version' | 'stale-metadata' | 'immutable-artifact-mismatch'
    channel: string
    dist: string
    currentVersion: string
    targetVersion: string
    bundleVersion: string
    updateAvailable: boolean
    plan: Array<{
        key: string
        action: 'blocked' | 'install' | 'remove' | 'reuse'
        required: boolean
        fromVersion?: string
        toVersion: string
        delivery: 'none' | 'full' | 'bsdiff'
        downloadBytes: number
        restartRequired: boolean
    }>
    policy: {
        currentVersionDeprecated: boolean
        matchedDeprecatedRange?: string
        invalidDeprecatedRanges: string[]
        forced: boolean
        forceReason: 'deprecated-version' | null
        minClientVersion: string | null
    }
}

export type EffectiveManifestSourceV1 = {
    requested: RequestedManifestSource
    effective: RequestedManifestSource
    url: string
    fallbackUsed: boolean
    fallbackReason: 'health-unavailable' | 'requested-github' | null
}

export type PrepareUpdateResultV1 =
    | { schemaVersion: 1; state: 'up-to-date'; decision: UpdateDecisionV1; source: EffectiveManifestSourceV1 }
    | {
          schemaVersion: 1
          state: 'prepared'
          decision: UpdateDecisionV1
          source: EffectiveManifestSourceV1
          reused: boolean
          transaction: { id: string; dir: string; file: string }
          applyDeferredByLeaseId: string
      }
    | { schemaVersion: 1; state: 'blocked'; decision?: UpdateDecisionV1; source?: EffectiveManifestSourceV1; block: RustBlockV1 }

export type DiscardPreparedUpdateResultV1 = {
    schemaVersion: 1
    state: 'discarded' | 'not-found' | 'blocked'
    transactionId: string
    targetVersion: string | null
    reason: { code: string; retryable: boolean; safeToContinue: boolean }
    removed: { transaction: boolean; staging: boolean; backup: boolean }
}

export type RepairRuntimeResultV3 = {
    schemaVersion: 3
    state: 'healthy' | 'repaired' | 'partial'
    bundleVersion: string
    items: Array<{ key: string; required: boolean; state: 'healthy' | 'repaired' | 'failed'; reason?: string }>
}

export type LaunchRequestInputV1 = {
    schemaVersion: 1
    kind: 'activate' | 'arguments'
    argv: string[]
    workingDirectory?: string
    additionalData?: Record<string, string | number | boolean | null>
}

export type LaunchRequestEnvelopeV1 = LaunchRequestInputV1 & {
    id: string
    sequence: number
    inboxId: string
    inboxGeneration: number
    enqueuedByLeaseId: string
    state: 'pending' | 'claimed'
    claimedByLeaseId?: string
    claimedByPid?: number
    claimedByProcessStartId?: string
}

export type EnqueueLaunchRequestResultV1 = { schemaVersion: 1; state: 'enqueued'; request: LaunchRequestEnvelopeV1 }
export type ClaimLaunchRequestsResultV1 = { schemaVersion: 1; state: 'claimed'; requests: LaunchRequestEnvelopeV1[] }
export type AckLaunchRequestResultV1 = { schemaVersion: 1; state: 'acked' | 'already-acked' | 'not-found'; requestId: string }
export type StartResultV1 = Record<string, unknown> & { schemaVersion: 1; state: 'blocked' | 'busy' | 'enqueued' | 'launched' | 'reserved' }
export type { ActiveRuntimeV3, RuntimeAcknowledgementV3 } from '@common/desktopRuntime/contract'
import type { ActiveRuntimeV3, RuntimeAcknowledgementV3 } from '@common/desktopRuntime/contract'

const UPDATE_STAGES: RustUpdateStage[] = ['resolving-source', 'checking', 'downloading', 'planning', 'preparing', 'prepared', 'up-to-date', 'blocked']
const UPDATE_ERROR_PHASES: UpdateErrorV1['error']['phase'][] = [
    'validate-input',
    'lock',
    'resolve-source',
    'fetch-manifest',
    'validate-manifest',
    'decide',
    'download',
    'plan',
    'prepare',
    'discard',
    'handoff',
]

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
    return isNonNegativeInteger(value) && value > 0
}

function isBoolean(value: unknown): value is boolean {
    return typeof value === 'boolean'
}

function isRequestedSource(value: unknown): value is RequestedManifestSource {
    return value === 'backend' || value === 'github' || value === 'direct'
}

function isArtifactKey(value: unknown): value is BootstrapperArtifactKey {
    return value === 'host' || value === 'bootstrapper' || (typeof value === 'string' && /^module:[^:/\\]+$/u.test(value))
}

function requireContract<T>(value: unknown, predicate: (candidate: unknown) => candidate is T, label: string): T {
    if (!predicate(value)) {
        throw new Error(`Invalid ${label} contract`)
    }
    return value
}

export function parseRustUpdateProgress(value: unknown): RustUpdateProgressEventV1 | null {
    if (
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        (value.event !== 'stage' && value.event !== 'artifact-progress') ||
        !UPDATE_STAGES.includes(value.stage as RustUpdateStage) ||
        typeof value.message !== 'string'
    ) {
        return null
    }
    if (
        value.event === 'artifact-progress' &&
        (!isArtifactKey(value.artifactKey) ||
            !isPositiveInteger(value.artifactIndex) ||
            !isPositiveInteger(value.artifactCount) ||
            value.artifactIndex > value.artifactCount ||
            !isNonNegativeInteger(value.bytesRead) ||
            (value.bytesTotal !== undefined && !isNonNegativeInteger(value.bytesTotal)))
    ) {
        return null
    }
    if (value.path !== undefined && typeof value.path !== 'string') {
        return null
    }
    return value as RustUpdateProgressEventV1
}

export function parseHandoffArmedProgress(value: unknown): RustHandoffArmedEventV1 | null {
    if (
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        value.event !== 'handoff-armed' ||
        !isNonEmptyString(value.handoffId) ||
        !isNonEmptyString(value.activeLeaseId) ||
        !isPositiveInteger(value.waitingForPid) ||
        !isPositiveInteger(value.rustPid)
    ) {
        return null
    }
    return value as RustHandoffArmedEventV1
}

export function isUpdateErrorV1(value: unknown): value is UpdateErrorV1 {
    return (
        isRecord(value) &&
        value.schemaVersion === 1 &&
        value.state === 'error' &&
        isNonEmptyString(value.command) &&
        isRecord(value.error) &&
        isNonEmptyString(value.error.code) &&
        UPDATE_ERROR_PHASES.includes(value.error.phase as UpdateErrorV1['error']['phase']) &&
        typeof value.error.message === 'string' &&
        isBoolean(value.error.retryable) &&
        isBoolean(value.error.safeToContinue)
    )
}

function isRustBlock(value: unknown): value is RustBlockV1 {
    return (
        isRecord(value) &&
        isNonEmptyString(value.code) &&
        isBoolean(value.retryable) &&
        isBoolean(value.safeToContinue) &&
        (value.checkIds === undefined || (Array.isArray(value.checkIds) && value.checkIds.every(isNonEmptyString)))
    )
}

function isActiveAppLease(value: unknown): value is ActiveAppLeaseV1 {
    return (
        isRecord(value) &&
        value.schemaVersion === 1 &&
        isNonEmptyString(value.leaseId) &&
        (value.state === 'active' || value.state === 'handoff-armed') &&
        isPositiveInteger(value.pid) &&
        isNonEmptyString(value.processStartId) &&
        isNonEmptyString(value.executable) &&
        isNonEmptyString(value.launchProofId) &&
        (value.launchProofKind === 'reservation' || value.launchProofKind === 'handoff' || value.launchProofKind === 'recovery') &&
        isNonEmptyString(value.inboxId) &&
        isPositiveInteger(value.inboxGeneration)
    )
}

function isUpdateDecision(value: unknown): value is UpdateDecisionV1 {
    return (
        isRecord(value) &&
        (value.reason === 'update-available' ||
            value.reason === 'up-to-date' ||
            value.reason === 'missing-dist-artifacts' ||
            value.reason === 'invalid-version' ||
            value.reason === 'stale-metadata' ||
            value.reason === 'immutable-artifact-mismatch') &&
        isNonEmptyString(value.channel) &&
        isNonEmptyString(value.dist) &&
        isNonEmptyString(value.currentVersion) &&
        isNonEmptyString(value.targetVersion) &&
        isNonEmptyString(value.bundleVersion) &&
        isBoolean(value.updateAvailable) &&
        Array.isArray(value.plan) &&
        value.plan.every(
            item =>
                isRecord(item) &&
                isNonEmptyString(item.key) &&
                (item.action === 'blocked' || item.action === 'install' || item.action === 'remove' || item.action === 'reuse') &&
                isBoolean(item.required) &&
                (item.fromVersion === undefined || isNonEmptyString(item.fromVersion)) &&
                isNonEmptyString(item.toVersion) &&
                (item.delivery === 'none' || item.delivery === 'full' || item.delivery === 'bsdiff') &&
                typeof item.downloadBytes === 'number' &&
                Number.isSafeInteger(item.downloadBytes) &&
                item.downloadBytes >= 0 &&
                isBoolean(item.restartRequired),
        ) &&
        isRecord(value.policy) &&
        isBoolean(value.policy.currentVersionDeprecated) &&
        Array.isArray(value.policy.invalidDeprecatedRanges) &&
        value.policy.invalidDeprecatedRanges.every(isNonEmptyString) &&
        isBoolean(value.policy.forced)
    )
}

function isEffectiveSource(value: unknown): value is EffectiveManifestSourceV1 {
    return (
        isRecord(value) &&
        isRequestedSource(value.requested) &&
        isRequestedSource(value.effective) &&
        isNonEmptyString(value.url) &&
        isBoolean(value.fallbackUsed) &&
        (value.fallbackReason === null || value.fallbackReason === 'health-unavailable' || value.fallbackReason === 'requested-github')
    )
}

function isPrepareResult(value: unknown): value is PrepareUpdateResultV1 | UpdateErrorV1 {
    if (isUpdateErrorV1(value)) return true
    if (!isRecord(value) || value.schemaVersion !== 1) return false
    if (value.state === 'up-to-date') return isUpdateDecision(value.decision) && isEffectiveSource(value.source)
    if (value.state === 'prepared') {
        return (
            isUpdateDecision(value.decision) &&
            isEffectiveSource(value.source) &&
            isBoolean(value.reused) &&
            isRecord(value.transaction) &&
            isNonEmptyString(value.transaction.id) &&
            isNonEmptyString(value.transaction.dir) &&
            isNonEmptyString(value.transaction.file) &&
            isNonEmptyString(value.applyDeferredByLeaseId)
        )
    }
    return (
        value.state === 'blocked' &&
        isRustBlock(value.block) &&
        (value.decision === undefined || isUpdateDecision(value.decision)) &&
        (value.source === undefined || isEffectiveSource(value.source))
    )
}

function isClaimResult(value: unknown): value is ClaimActiveAppResultV1 | UpdateErrorV1 {
    if (isUpdateErrorV1(value)) return true
    return (
        isRecord(value) &&
        value.schemaVersion === 1 &&
        ((value.state === 'claimed' && isActiveAppLease(value.lease) && isBoolean(value.adoptedLaunchReservation)) ||
            (value.state === 'blocked' && isRustBlock(value.block)))
    )
}

function isDiscardResult(value: unknown): value is DiscardPreparedUpdateResultV1 | UpdateErrorV1 {
    if (isUpdateErrorV1(value)) return true
    return (
        isRecord(value) &&
        value.schemaVersion === 1 &&
        (value.state === 'discarded' || value.state === 'not-found' || value.state === 'blocked') &&
        isNonEmptyString(value.transactionId) &&
        (value.targetVersion === null || typeof value.targetVersion === 'string') &&
        isRecord(value.reason) &&
        isNonEmptyString(value.reason.code) &&
        isBoolean(value.reason.retryable) &&
        isBoolean(value.reason.safeToContinue) &&
        isRecord(value.removed) &&
        isBoolean(value.removed.transaction) &&
        isBoolean(value.removed.staging) &&
        isBoolean(value.removed.backup)
    )
}

function isLaunchRequest(value: unknown): value is LaunchRequestEnvelopeV1 {
    return (
        isRecord(value) &&
        value.schemaVersion === 1 &&
        isNonEmptyString(value.id) &&
        isPositiveInteger(value.sequence) &&
        isNonEmptyString(value.inboxId) &&
        isPositiveInteger(value.inboxGeneration) &&
        isNonEmptyString(value.enqueuedByLeaseId) &&
        (value.state === 'pending' || value.state === 'claimed') &&
        (value.kind === 'activate' || value.kind === 'arguments') &&
        Array.isArray(value.argv) &&
        value.argv.every(item => typeof item === 'string') &&
        !('claimedByExecutable' in value)
    )
}

function isEnqueueResult(value: unknown): value is EnqueueLaunchRequestResultV1 | UpdateErrorV1 {
    return isUpdateErrorV1(value) || (isRecord(value) && value.schemaVersion === 1 && value.state === 'enqueued' && isLaunchRequest(value.request))
}

function isClaimRequestsResult(value: unknown): value is ClaimLaunchRequestsResultV1 | UpdateErrorV1 {
    return (
        isUpdateErrorV1(value) ||
        (isRecord(value) &&
            value.schemaVersion === 1 &&
            value.state === 'claimed' &&
            Array.isArray(value.requests) &&
            value.requests.every(isLaunchRequest))
    )
}

function isAckResult(value: unknown): value is AckLaunchRequestResultV1 | UpdateErrorV1 {
    return (
        isUpdateErrorV1(value) ||
        (isRecord(value) &&
            value.schemaVersion === 1 &&
            (value.state === 'acked' || value.state === 'already-acked' || value.state === 'not-found') &&
            isNonEmptyString(value.requestId))
    )
}

function isStartResult(value: unknown): value is StartResultV1 | UpdateErrorV1 {
    return (
        isUpdateErrorV1(value) ||
        (isRecord(value) &&
            value.schemaVersion === 1 &&
            (value.state === 'blocked' ||
                value.state === 'busy' ||
                value.state === 'enqueued' ||
                value.state === 'launched' ||
                value.state === 'reserved'))
    )
}

function isActiveRuntimeV3(value: unknown): value is ActiveRuntimeV3 {
    return (
        isRecord(value) &&
        value.schemaVersion === 3 &&
        isPositiveInteger(value.generation) &&
        isNonEmptyString(value.bundleVersion) &&
        typeof value.metadataVersion === 'number' &&
        Number.isSafeInteger(value.metadataVersion) &&
        value.metadataVersion >= 0 &&
        isNonEmptyString(value.hostVersion) &&
        isNonEmptyString(value.hostPath) &&
        isNonEmptyString(value.coreVersion) &&
        isNonEmptyString(value.corePath) &&
        isNonEmptyString(value.coreEntry) &&
        isNonEmptyString(value.corePreload) &&
        isRecord(value.components) &&
        Object.values(value.components).every(
            component =>
                isRecord(component) &&
                isNonEmptyString(component.version) &&
                isNonEmptyString(component.path) &&
                isNonEmptyString(component.sha256) &&
                isBoolean(component.required),
        ) &&
        Array.isArray(value.optionalFailures) &&
        value.optionalFailures.every(failure => isRecord(failure) && isNonEmptyString(failure.key) && isNonEmptyString(failure.reason)) &&
        (value.activationState === 'pending' || value.activationState === 'confirmed')
    )
}

function isRuntimeAcknowledgementV3(value: unknown): value is RuntimeAcknowledgementV3 {
    return isRecord(value) && value.schemaVersion === 3 && value.state === 'confirmed' && isPositiveInteger(value.generation)
}

function isRepairRuntimeResultV3(value: unknown): value is RepairRuntimeResultV3 {
    return (
        isRecord(value) &&
        value.schemaVersion === 3 &&
        (value.state === 'healthy' || value.state === 'repaired' || value.state === 'partial') &&
        isNonEmptyString(value.bundleVersion) &&
        Array.isArray(value.items) &&
        value.items.every(
            item =>
                isRecord(item) &&
                isNonEmptyString(item.key) &&
                isBoolean(item.required) &&
                (item.state === 'healthy' || item.state === 'repaired' || item.state === 'failed') &&
                (item.reason === undefined || isNonEmptyString(item.reason)),
        )
    )
}

export const parseClaimResult = (value: unknown): ClaimActiveAppResultV1 | UpdateErrorV1 =>
    requireContract(value, isClaimResult, 'claim-active-app result')
export const parsePrepareResult = (value: unknown): PrepareUpdateResultV1 | UpdateErrorV1 =>
    requireContract(value, isPrepareResult, 'prepare-update result')
export const parseDiscardResult = (value: unknown): DiscardPreparedUpdateResultV1 | UpdateErrorV1 =>
    requireContract(value, isDiscardResult, 'discard-prepared-update result')
export const parseEnqueueResult = (value: unknown): EnqueueLaunchRequestResultV1 | UpdateErrorV1 =>
    requireContract(value, isEnqueueResult, 'enqueue-launch-request result')
export const parseClaimRequestsResult = (value: unknown): ClaimLaunchRequestsResultV1 | UpdateErrorV1 =>
    requireContract(value, isClaimRequestsResult, 'claim-launch-requests result')
export const parseAckResult = (value: unknown): AckLaunchRequestResultV1 | UpdateErrorV1 =>
    requireContract(value, isAckResult, 'ack-launch-request result')
export const parseStartResult = (value: unknown): StartResultV1 | UpdateErrorV1 => requireContract(value, isStartResult, 'start result')
export const parseActiveRuntimeV3 = (value: unknown): ActiveRuntimeV3 | UpdateErrorV1 =>
    requireContract(value, candidate => isUpdateErrorV1(candidate) || isActiveRuntimeV3(candidate), 'active runtime v3')
export const parseRuntimeAcknowledgementV3 = (value: unknown): RuntimeAcknowledgementV3 | UpdateErrorV1 =>
    requireContract(value, candidate => isUpdateErrorV1(candidate) || isRuntimeAcknowledgementV3(candidate), 'runtime acknowledgement v3')
export const parseRepairRuntimeResultV3 = (value: unknown): RepairRuntimeResultV3 | UpdateErrorV1 =>
    requireContract(value, candidate => isUpdateErrorV1(candidate) || isRepairRuntimeResultV3(candidate), 'repair runtime result v3')

export function unwrapSemanticResult<TResult>(result: TResult | UpdateErrorV1): TResult {
    if (isUpdateErrorV1(result)) {
        throw new Error(`Bootstrapper returned error ${result.error.code} on exit 0`)
    }
    return result
}
