import type { Plugin } from 'vite'
import fs from 'fs'
import path from 'path'

export const createDeleteSourceMapsPlugin = (outDir: string = '.vite'): Plugin => {
    return {
        name: 'delete-source-maps',
        apply: 'build',
        closeBundle() {
            const deleteMapFiles = (dir: string) => {
                if (!fs.existsSync(dir)) {
                    console.warn(`[delete-source-maps] Directory does not exist: ${dir}`)
                    return
                }
                try {
                    const files = fs.readdirSync(dir, { withFileTypes: true })
                    for (const file of files) {
                        const fullPath = path.join(dir, file.name)
                        if (file.isDirectory()) {
                            deleteMapFiles(fullPath)
                        } else if (file.name.endsWith('.map')) {
                            try {
                                fs.unlinkSync(fullPath)
                                console.log(`[delete-source-maps] Deleted: ${fullPath}`)
                            } catch (err) {
                                console.warn(`[delete-source-maps] Failed to delete ${fullPath}:`, err)
                            }
                        }
                    }
                } catch (err) {
                    console.error(`[delete-source-maps] Error processing directory ${dir}:`, err)
                }
            }
            console.log(`[delete-source-maps] Starting cleanup in: ${outDir}`)
            deleteMapFiles(outDir)
            console.log(`[delete-source-maps] Cleanup completed`)
        },
    }
}
