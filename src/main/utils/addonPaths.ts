import { app } from 'electron'
import * as fs from 'original-fs'
import path from 'path'

export const getAddonsRoot = (): string => path.join(app.getPath('appData'), 'PulseSync', 'addons')

export const isPathInsideBase = (baseDir: string, targetPath: string): boolean => {
    const resolvedBase = path.resolve(baseDir)
    const resolvedTarget = path.resolve(targetPath)
    const relativePath = path.relative(resolvedBase, resolvedTarget)

    return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export const resolvePathInsideBase = (baseDir: string, targetPath: string): string | null => {
    const resolvedTarget = path.resolve(targetPath)
    return isPathInsideBase(baseDir, resolvedTarget) ? resolvedTarget : null
}

export const resolveRelativePathInsideBase = (baseDir: string, relativePath: string): string | null => {
    const normalizedRelativePath = String(relativePath || '')
        .trim()
        .replace(/^["']|["']$/g, '')
    if (!normalizedRelativePath || path.isAbsolute(normalizedRelativePath)) {
        return null
    }

    return resolvePathInsideBase(baseDir, path.join(baseDir, normalizedRelativePath))
}

export const resolveExistingPathInsideBase = (baseDir: string, targetPath: string): string | null => {
    const resolvedTarget = resolvePathInsideBase(baseDir, targetPath)
    if (!resolvedTarget || !fs.existsSync(resolvedTarget) || !fs.statSync(resolvedTarget).isFile()) {
        return null
    }

    try {
        const realBase = fs.realpathSync(baseDir)
        const realTarget = fs.realpathSync(resolvedTarget)
        if (!isPathInsideBase(realBase, realTarget)) {
            return null
        }
    } catch {
        return null
    }

    return resolvedTarget
}

export const resolveExistingFileInsideBase = (baseDir: string, relativePath: string): string | null => {
    const targetPath = resolveRelativePathInsideBase(baseDir, relativePath)
    if (!targetPath || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
        return null
    }

    try {
        const realBase = fs.realpathSync(baseDir)
        const realTarget = fs.realpathSync(targetPath)
        if (!isPathInsideBase(realBase, realTarget)) {
            return null
        }
    } catch {
        return null
    }

    return targetPath
}

export const resolveExistingDirectoryInsideBase = (baseDir: string, targetPath: string): string | null => {
    const resolvedTarget = resolvePathInsideBase(baseDir, targetPath)
    if (!resolvedTarget || !fs.existsSync(resolvedTarget) || !fs.statSync(resolvedTarget).isDirectory()) {
        return null
    }

    try {
        const realBase = fs.realpathSync(baseDir)
        const realTarget = fs.realpathSync(resolvedTarget)
        if (!isPathInsideBase(realBase, realTarget)) {
            return null
        }
    } catch {
        return null
    }

    return resolvedTarget
}
