import { spawnSync } from 'node:child_process'

import { retryNetworkOperation } from './network-retry.js'

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    if (!args.length) throw new Error('Usage: github-release-upload.ts <tag> --repo <owner/repo> [--clobber] <files...>')
    if (!args.includes('--clobber')) throw new Error('Retried release uploads require --clobber')
    await retryNetworkOperation(
        async () => {
            const result = spawnSync(process.platform === 'win32' ? 'gh.exe' : 'gh', ['release', 'upload', ...args], {
                encoding: 'utf8',
                windowsHide: true,
                maxBuffer: 10 * 1024 * 1024,
            })
            if (result.stdout) process.stdout.write(result.stdout)
            if (result.stderr) process.stderr.write(result.stderr)
            if (result.error) throw result.error
            if (result.signal) throw new Error(`GitHub asset upload terminated by ${result.signal}`)
            if (result.status === 0) return
            const detail = `${result.stderr}\n${result.stdout}`.trim()
            const status = /\bHTTP\s+(\d{3})\b/iu.exec(detail)?.[1]
            throw Object.assign(new Error(`GitHub asset upload failed (exit ${result.status ?? result.signal}): ${detail}`), {
                status: status ? Number(status) : undefined,
            })
        },
        { label: 'GitHub release assets' },
    )
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
})
