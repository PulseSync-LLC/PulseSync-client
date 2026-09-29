import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const windowsScript = fileURLToPath(new URL('./windows-sign.ps1', import.meta.url))
const machOMagic = new Set(['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'])

function walk(root: string): string[] {
    const stat = fs.lstatSync(root)
    if (stat.isSymbolicLink()) return []
    if (!stat.isDirectory()) return [root]
    return fs
        .readdirSync(root)
        .flatMap(name => walk(path.join(root, name)))
        .concat(root)
}

function codesign(args: string[]): void {
    execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' })
}

export function prepareCodeSigning(): void {
    if (process.platform === 'win32') {
        execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', windowsScript, '-Initialize'], {
            stdio: 'inherit',
            windowsHide: true,
        })
    }
}

export function signRuntimeBinaries(root: string): void {
    if (process.platform === 'win32') {
        execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', windowsScript, '-Path', path.resolve(root)], {
            stdio: 'inherit',
            windowsHide: true,
        })
    } else if (process.platform === 'darwin') {
        for (const file of walk(root)) {
            if (!fs.statSync(file).isFile()) continue
            const fd = fs.openSync(file, 'r')
            const magic = Buffer.alloc(4)
            try {
                fs.readSync(fd, magic, 0, 4, 0)
            } finally {
                fs.closeSync(fd)
            }
            if (!machOMagic.has(magic.toString('hex'))) continue
            codesign(['--force', '--sign', '-', '--timestamp=none', file])
            codesign(['--verify', '--strict', file])
        }
    }
}

export function signMacBundle(appPath: string): void {
    if (process.platform !== 'darwin') throw new Error('macOS bundle signing requires macOS')
    // Binaries/components are already signed and hashed; seal only bundle containers, inside out.
    const frameworks = path.join(appPath, 'Contents', 'Frameworks')
    for (const entry of [...(fs.existsSync(frameworks) ? walk(frameworks) : []), appPath]) {
        if (fs.statSync(entry).isDirectory() && /\.(app|framework)$/u.test(entry)) {
            codesign(['--force', '--sign', '-', '--timestamp=none', entry])
        }
    }
    codesign(['--verify', '--deep', '--strict', '--verbose=2', appPath])
}
