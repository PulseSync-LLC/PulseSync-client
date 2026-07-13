import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveStructuredPublishPath } from '../s3-upload.js'

async function main(): Promise<void> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsesync-release-routing-'))
    try {
        const version = '2.3.4'
        const dist = 'darwin-arm64'
        const fileName = `pulsesync-host-bundle-${version}-${dist}.zip`
        const artifact = path.join(root, fileName)
        fs.writeFileSync(artifact, 'macos-host-fixture')
        const hash = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex').slice(0, 16)
        const actual = await resolveStructuredPublishPath(artifact, version)
        const expected = `bundles/${version}/${dist}/${hash}/${fileName}`
        if (actual !== expected) {
            throw new Error(`macOS host artifact route mismatch: expected ${expected}, got ${actual}`)
        }
        console.log(`macOS host artifact route ok: ${actual}`)

        const fixtures = [
            {
                fileName: `pulsesync-component-desktopCore-${version}-${dist}.zip`,
                expectedPrefix: `components/desktopCore/${version}/${dist}`,
            },
            {
                fileName: `pulsesync-component-file-desktopCore-${version}-0123456789abcdef-${dist}.bin`,
                expectedPrefix: `components/desktopCore/${version}/${dist}/files`,
            },
            {
                fileName: `pulsesync-component-patch-bsdiff-desktopCore-${version}-0123456789abcdef-fedcba9876543210-${dist}.patch`,
                expectedPrefix: `components/desktopCore/${version}/${dist}/patches/bsdiff/0123456789abcdef`,
            },
        ]
        for (const fixture of fixtures) {
            const fixturePath = path.join(root, fixture.fileName)
            fs.writeFileSync(fixturePath, fixture.fileName)
            const fixtureHash = crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex').slice(0, 16)
            const fixtureActual = await resolveStructuredPublishPath(fixturePath, version)
            const fixtureExpected = `${fixture.expectedPrefix}/${fixtureHash}/${fixture.fileName}`
            if (fixtureActual !== fixtureExpected) {
                throw new Error(`Darwin component route mismatch: expected ${fixtureExpected}, got ${fixtureActual}`)
            }
        }
        for (const manifestName of [`desktop-update-${dist}.json`, `desktop-update-hybrid-${dist}.json`]) {
            const manifestPath = path.join(root, manifestName)
            fs.writeFileSync(manifestPath, '{}')
            const manifestActual = await resolveStructuredPublishPath(manifestPath, version)
            if (manifestActual !== manifestName) {
                throw new Error(`Manifest route mismatch: expected ${manifestName}, got ${manifestActual}`)
            }
        }
        console.log('Darwin component and dual-manifest routes ok')
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
}

main().catch(error => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    process.exitCode = 1
})
