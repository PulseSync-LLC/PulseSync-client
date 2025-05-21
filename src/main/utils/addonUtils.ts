import { app } from 'electron'
import path from 'path'
import * as fs from 'original-fs'
import { getFolderSize, formatSizeUnits } from './appUtils'
import logger from '../modules/logger'
import { store } from '../modules/storage'
import Addon from '../../renderer/api/interfaces/addon.interface'

const defaultAddon: Partial<Addon> = {
    name: 'Default',
    image: 'url',
    author: 'Your Name',
    description: 'Default theme.',
    version: '1.0.0',
    type: 'theme',
    css: 'style.css',
    script: 'script.js',
    dependencies: [],
}

const defaultCssContent = `{}`

const defaultScriptContent = ``

export function createDefaultAddonIfNotExists(themesFolderPath: string) {
    const defaultAddonPath = path.join(themesFolderPath, defaultAddon.name!)
    const metadataPath = path.join(defaultAddonPath, 'metadata.json')

    try {
        if (fs.existsSync(defaultAddonPath)) {
            if (fs.existsSync(metadataPath)) {
                let metadata
                try {
                    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
                } catch (err) {
                    logger.main.error(`Addons: error parsing metadata.json in ${defaultAddonPath}:`, err)
                    return
                }
                if (!metadata.hasOwnProperty('type')) {
                    metadata.type = defaultAddon.type
                    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 4), 'utf-8')
                    logger.main.info(`Addons: metadata.json updated in ${defaultAddonPath}.`)
                }
            }
            return
        }

        fs.mkdirSync(defaultAddonPath, { recursive: true })
        fs.mkdirSync(path.join(defaultAddonPath, 'Assets'), { recursive: true })

        const cssPath = path.join(defaultAddonPath, defaultAddon.css!)
        const scriptPath = path.join(defaultAddonPath, defaultAddon.script!)

        fs.writeFileSync(metadataPath, JSON.stringify(defaultAddon, null, 4), 'utf-8')
        fs.writeFileSync(cssPath, defaultCssContent, 'utf-8')
        fs.writeFileSync(scriptPath, defaultScriptContent, 'utf-8')

        logger.main.info(`Addons: default theme created at ${defaultAddonPath}.`)
    } catch (err) {
        logger.main.error(`Addons: error creating default theme at ${defaultAddonPath}:`, err)
    }
}

export async function loadAddons(): Promise<Addon[]> {
    const addonsFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')

    createDefaultAddonIfNotExists(addonsFolderPath)

    const folders = await fs.promises.readdir(addonsFolderPath)
    const availableAddons: Addon[] = []

    for (const folder of folders) {
        const addonFolderPath = path.join(addonsFolderPath, folder)
        const metadataFilePath = path.join(addonFolderPath, 'metadata.json')

        if (fs.existsSync(metadataFilePath)) {
            try {
                const data = await fs.promises.readFile(metadataFilePath, 'utf-8')
                const stats = await fs.promises.stat(metadataFilePath)
                const folderSize = await getFolderSize(addonFolderPath)
                const modificationDate = new Date(stats.mtime)
                const now = new Date()

                const diffTime = Math.abs(now.getTime() - modificationDate.getTime())
                let diffString: string
                const diffSeconds = Math.floor(diffTime / 1000)
                const diffMinutes = Math.floor(diffSeconds / 60)
                const diffHours = Math.floor(diffMinutes / 60)
                const diffDays = Math.floor(diffHours / 24)

                if (diffSeconds < 60) {
                    diffString = `${diffSeconds} sec ago`
                } else if (diffMinutes < 60) {
                    diffString = `${diffMinutes} min ago`
                } else if (diffHours < 24) {
                    diffString = `${diffHours} hours ago`
                } else {
                    diffString = `${diffDays} days ago`
                }

                const versionRegex = /^\d+(\.\d+){0,2}$/
                const metadata = JSON.parse(data) as Addon
                const versionMatch = metadata.version.match(versionRegex)
                if (!versionMatch) {
                    logger.main.log(`Addons: No valid version found in theme ${metadataFilePath}. Setting version to 1.0.0`)
                    metadata.version = '1.0.0'
                    await fs.promises.writeFile(metadataFilePath, JSON.stringify(metadata, null, 4), 'utf-8').catch(err => {
                        logger.main.error(`Addons: error writing metadata.json in theme ${folder}:`, err)
                    })
                } else {
                    metadata.version = versionMatch[0]
                }

                metadata.lastModified = diffString
                metadata.path = addonFolderPath
                metadata.size = formatSizeUnits(folderSize)
                metadata.directoryName = folder

                availableAddons.push(metadata)
            } catch (err) {
                logger.main.error(`Addons: error reading or parsing metadata.json in theme ${folder}:`, err)
            }
        } else {
            logger.main.error(`Addons: metadata.json not found in theme ${folder}`)
        }
    }

    let selectedTheme = store.get('addons.theme') as string
    let selectedScripts = store.get('addons.scripts') as string[]

    const themeAddonExists = availableAddons.some(addon => addon.type === 'theme' && addon.directoryName === selectedTheme)
    if (!themeAddonExists) {
        selectedTheme = 'Default'
        store.set('addons.theme', selectedTheme)
    }

    selectedScripts = availableAddons
        .filter(addon => addon.type === 'script' && selectedScripts.includes(addon.directoryName!))
        .map(addon => addon.directoryName!)
    store.set('addons.scripts', selectedScripts)

    availableAddons.forEach(addon => {
        if (addon.type === 'theme' && addon.directoryName === selectedTheme) {
            addon.enabled = true
        } else if (addon.type === 'script' && selectedScripts.includes(addon.directoryName!)) {
            addon.enabled = true
        }
    })

    return availableAddons
}
