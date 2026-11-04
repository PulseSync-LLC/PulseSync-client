import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import semver from 'semver'

const versionFile = 'src/common/desktopApi/version.ts'
const apiInputs = [
    /^src\/common\/desktopApi\/(?!version\.ts$)/u,
    /^src\/common\/types\/(?:mainEvents|rendererEvents)\.ts$/u,
    /^src\/preload\/(?:desktopApiPreload|mainWindowPreload)\.ts$/u,
    /^src\/renderer\/shared\/desktop\/desktopApi\.ts$/u,
]

function git(root, args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function readVersion(source) {
    const version = /export const DESKTOP_API_VERSION\s*=\s*['"]([^'"]+)['"]/u.exec(source)?.[1]
    if (!semver.valid(version)) throw new Error(`Invalid DESKTOP_API_VERSION in ${versionFile}: ${version}`)
    return version
}

export function checkDesktopApiVersion({ changedFiles, before, after }) {
    const apiChanges = changedFiles.filter(file => apiInputs.some(pattern => pattern.test(file)))
    const errors = []
    if (!semver.valid(before) || !semver.valid(after)) {
        errors.push(`Desktop API: invalid version (${before} -> ${after})`)
    } else if (semver.lt(after, before) || (apiChanges.length && !semver.gt(after, before))) {
        errors.push(
            `Desktop API: increase DESKTOP_API_VERSION in ${versionFile} above ${before} (got ${after}). Inputs: ${apiChanges.join(', ') || 'version downgrade'}`,
        )
    }
    return { errors, apiChanges }
}

// With no head, include staged and unstaged changes for local verification.
export function verifyDesktopApiVersion(base, head = null, root = process.cwd()) {
    const baseSha = git(root, ['rev-parse', '--verify', `${base}^{commit}`])
    const headSha = head ? git(root, ['rev-parse', '--verify', `${head}^{commit}`]) : null
    const mergeBase = headSha ? git(root, ['merge-base', baseSha, headSha]) : baseSha
    const changedFiles = git(root, ['diff', '--name-only', '--no-renames', '-z', mergeBase, ...(headSha ? [headSha] : []), '--'])
        .split('\0')
        .filter(Boolean)
    const before = readVersion(git(root, ['show', `${baseSha}:${versionFile}`]))
    const after = readVersion(headSha ? git(root, ['show', `${headSha}:${versionFile}`]) : fs.readFileSync(path.join(root, versionFile), 'utf8'))
    const branchVersion = readVersion(git(root, ['show', `${mergeBase}:${versionFile}`]))
    return checkDesktopApiVersion({ changedFiles, before, after: headSha && after === branchVersion ? before : after })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const worktree = process.argv.includes('--worktree')
        const head = worktree ? null : process.env.HEAD_SHA || 'HEAD'
        const base = process.env.BASE_SHA && !/^0+$/u.test(process.env.BASE_SHA) ? process.env.BASE_SHA : worktree ? 'HEAD' : `${head}^`
        const result = verifyDesktopApiVersion(base, head)
        if (result.errors.length) throw new Error(result.errors.join('\n'))
        console.log(`Desktop API version OK (API inputs: ${result.apiChanges.length})`)
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}
