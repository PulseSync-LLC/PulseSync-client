import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const manifest = 'packages/desktop-core/package.json'

function hostMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid desktop core package')
    const metadata = structuredClone(value)
    delete metadata.version
    if (metadata.componentRevisions) {
        if (typeof metadata.componentRevisions !== 'object' || Array.isArray(metadata.componentRevisions)) {
            throw new Error('Invalid component revisions')
        }
        delete metadata.componentRevisions.desktopCore
    }
    return metadata
}

export function classifyCorePackageChanges(previous, current) {
    const desktop = !isDeepStrictEqual(hostMetadata(previous), hostMetadata(current))
    return {
        desktop,
        details: [desktop ? 'Desktop core package: host/component layout changed' : 'Desktop core package: only core version/revision changed'],
    }
}

export function classifyCorePackagePush(before, root = process.cwd()) {
    try {
        if (!/^[a-f0-9]{40}$/iu.test(before ?? '') || /^0+$/u.test(before)) throw new Error('Missing previous commit for core package changes')
        const previous = JSON.parse(
            execFileSync('git', ['show', `${before}:${manifest}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
        )
        const current = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8'))
        return classifyCorePackageChanges(previous, current)
    } catch (error) {
        return { desktop: true, details: [error.message] }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const result = classifyCorePackagePush(process.env.BEFORE_SHA)
    for (const detail of result.details) console.log(detail)
    console.log(`desktop=${result.desktop}`)
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `desktop=${result.desktop}\n`)
}
