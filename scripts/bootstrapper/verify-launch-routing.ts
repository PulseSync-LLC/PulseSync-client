import assert from 'node:assert/strict'
import {
    canonicalStartSucceeded,
    claimShouldUseCanonicalStart,
    normalizeSecondInstanceArgv,
    requiresCanonicalStart,
} from '../../src/main/modules/bootstrapper/launchRouting'

assert.equal(
    requiresCanonicalStart({ isPackaged: true, platform: 'win32' }),
    true,
    'Windows payload launch without proof must route through bootstrapper start',
)
assert.equal(
    requiresCanonicalStart({ isPackaged: true, platform: 'linux' }),
    true,
    'Linux payload launch without proof must route through bootstrapper start',
)
assert.equal(requiresCanonicalStart({ isPackaged: true, platform: 'darwin' }), false, 'macOS bundle launch must retain unreserved recovery')
assert.equal(
    requiresCanonicalStart({
        isPackaged: true,
        launchReservationId: 'reservation',
        platform: 'win32',
    }),
    false,
    'a reservation-backed Windows launch must claim directly',
)
assert.equal(
    requiresCanonicalStart({ handoffId: 'handoff', isPackaged: true, platform: 'linux' }),
    false,
    'a handoff-backed Linux launch must claim directly',
)
assert.equal(requiresCanonicalStart({ isPackaged: false, platform: 'win32' }), false, 'development launch must not redirect')

const blockedClaim = (code: string) => ({
    schemaVersion: 1 as const,
    state: 'blocked' as const,
    block: { code, retryable: true, safeToContinue: false },
})

assert.equal(claimShouldUseCanonicalStart(blockedClaim('different-live-lease')), true)
assert.equal(claimShouldUseCanonicalStart(blockedClaim('missing-launch-reservation')), true)
assert.equal(claimShouldUseCanonicalStart(blockedClaim('handoff-mismatch')), false)

assert.equal(canonicalStartSucceeded({ schemaVersion: 1, state: 'enqueued' }), true)
assert.equal(canonicalStartSucceeded({ schemaVersion: 1, state: 'launched' }), true)
assert.equal(canonicalStartSucceeded({ schemaVersion: 1, state: 'reserved' }), true)
assert.equal(canonicalStartSucceeded({ schemaVersion: 1, state: 'blocked' }), false)
assert.equal(canonicalStartSucceeded({ schemaVersion: 1, state: 'busy' }), false)

assert.deepEqual(normalizeSecondInstanceArgv(['PulseSync.exe'], true), [])
assert.deepEqual(normalizeSecondInstanceArgv(['PulseSync.exe', 'pulsesync://settings'], true), ['pulsesync://settings'])
assert.deepEqual(normalizeSecondInstanceArgv(['PulseSync', '--enable-features=InternalFeature', '--secure-schemes=sentry-ipc'], true), [])
assert.deepEqual(normalizeSecondInstanceArgv(['PulseSync.exe', '--internal', '--', '--user-flag'], true), ['--user-flag'])
assert.deepEqual(normalizeSecondInstanceArgv(['electron', '.'], false), ['electron', '.'])

console.log('bootstrapper launch routing ok')
