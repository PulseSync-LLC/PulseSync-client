import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveStructuredPublishPath } from '../s3-upload.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsesync-release-routing-'))
try {
    const version = '2.3.4'
    const dist = 'darwin-arm64'
    const fileName = `pulsesync-host-bundle-${version}-${dist}.zip`
    const artifact = path.join(root, fileName)
    fs.writeFileSync(artifact, 'macos-host-fixture')
    const hash = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex').slice(0, 16)
    const actual = await resolveStructuredPublishPath(artifact, version)
    const expected = `hosts/${version}/${dist}/${hash}/${fileName}`
    if (actual !== expected) {
        throw new Error(`macOS host artifact route mismatch: expected ${expected}, got ${actual}`)
    }
    console.log(`macOS host artifact route ok: ${actual}`)
} finally {
    fs.rmSync(root, { recursive: true, force: true })
}
