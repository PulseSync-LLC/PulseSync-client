import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import semver from 'semver'

export function resolveReleaseTag(raw: string): { channel: 'dev' | 'beta'; version: string } {
    const version = raw
        .trim()
        .replace(/^refs\/tags\//u, '')
        .replace(/^v(?=\d)/u, '')
    const parsed = semver.parse(version)
    if (!parsed) throw new Error(`Release tag must be a semantic version: ${raw}`)
    const channel = parsed.prerelease.length === 0 ? 'beta' : parsed.prerelease[0]
    if (channel !== 'beta' && channel !== 'dev') throw new Error(`Unsupported release channel in tag: ${raw}`)
    return { channel, version: parsed.version }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { channel, version } = resolveReleaseTag(process.argv[2] ?? '')
    const output = `channel=${channel}\nversion=${version}\n`
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, output)
    else process.stdout.write(output)
}
