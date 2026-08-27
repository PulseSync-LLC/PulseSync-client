import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { app, ipcMain } from 'electron'

import i18next, { createInstance } from 'i18next'
import HttpBackend from 'i18next-http-backend'
import * as semver from 'semver'

import { DESKTOP_API_VERSION } from '@common/desktopApi/contract'
import {
    type DesktopLocalizationSnapshot,
    LOCALIZATION_CATALOG_SCHEMA_VERSION,
    parseRemoteLocalizationCatalog,
    type RemoteLocalizationCatalog,
    serializeLocalizationRevisionInput,
    SUPPORTED_LANGUAGES,
    type TranslationTree,
} from '@common/localization/catalog'

import MainEvents from '../../common/types/mainEvents'
import fallbackEn from '../../locales/en/main.json'
import fallbackRu from '../../locales/ru/main.json'
import logger from './logger'

import type { MainRendererSource } from './rendererSource'

const CACHE_FILE_NAME = 'catalog-v1.json'
const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const REMOTE_NAMESPACES = ['main', 'renderer'] as const

type CachedLocalizationCatalog = {
    sourceUrl: string
    catalog: RemoteLocalizationCatalog
}

const fallbackMainResources: Record<(typeof SUPPORTED_LANGUAGES)[number], TranslationTree> = {
    en: fallbackEn,
    ru: fallbackRu,
}

let rendererSnapshot: DesktopLocalizationSnapshot | null = null
let localizationIpcRegistered = false

const getCachePath = (): string => path.join(app.getPath('userData'), 'localization', CACHE_FILE_NAME)

const hasValidRevision = (catalog: RemoteLocalizationCatalog): boolean => {
    const revision = crypto.createHash('sha256').update(serializeLocalizationRevisionInput(catalog)).digest('hex')
    return revision === catalog.revision
}

const isDesktopApiCompatible = (requiredRange: string): boolean => {
    const current = semver.valid(DESKTOP_API_VERSION)
    return Boolean(current && semver.satisfies(current, requiredRange, { includePrerelease: true }))
}

const parseCatalog = (value: unknown): RemoteLocalizationCatalog | null => {
    const catalog = parseRemoteLocalizationCatalog(value)
    if (!catalog || !hasValidRevision(catalog) || !isDesktopApiCompatible(catalog.requiresDesktopApi)) return null
    return catalog
}

const applyCatalog = (catalog: RemoteLocalizationCatalog | null): void => {
    for (const language of SUPPORTED_LANGUAGES) {
        i18next.removeResourceBundle(language, 'translation')
        i18next.addResourceBundle(language, 'translation', catalog?.resources[language].main ?? fallbackMainResources[language], true, true)
    }

    rendererSnapshot = catalog
        ? {
              schemaVersion: LOCALIZATION_CATALOG_SCHEMA_VERSION,
              revision: catalog.revision,
              resources: {
                  en: catalog.resources.en.renderer,
                  ru: catalog.resources.ru.renderer,
              },
          }
        : null
}

const readCachedCatalog = async (sourceUrl: string): Promise<RemoteLocalizationCatalog | null> => {
    try {
        const cachePath = getCachePath()
        const stat = await fs.promises.stat(cachePath)
        if (!stat.isFile() || stat.size > MAX_CATALOG_BYTES) return null
        const cached = JSON.parse(await fs.promises.readFile(cachePath, 'utf8')) as Partial<CachedLocalizationCatalog>
        if (cached.sourceUrl !== sourceUrl) return null
        return parseCatalog(cached.catalog)
    } catch {
        return null
    }
}

const writeCachedCatalog = async (sourceUrl: string, catalog: RemoteLocalizationCatalog): Promise<void> => {
    const cachePath = getCachePath()
    const cacheDirectory = path.dirname(cachePath)
    const temporaryPath = `${cachePath}.${process.pid}.tmp`
    await fs.promises.mkdir(cacheDirectory, { recursive: true })
    try {
        await fs.promises.writeFile(temporaryPath, JSON.stringify({ sourceUrl, catalog } satisfies CachedLocalizationCatalog), 'utf8')
        await fs.promises.rename(temporaryPath, cachePath)
    } finally {
        await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined)
    }
}

const loadRemoteCatalog = async (sourceUrl: string, requiresDesktopApi: string): Promise<RemoteLocalizationCatalog> => {
    const loader = createInstance()
    const sourceBaseUrl = sourceUrl.endsWith('/') ? sourceUrl : `${sourceUrl}/`
    await loader.use(HttpBackend).init({
        lng: 'ru',
        fallbackLng: false,
        supportedLngs: [...SUPPORTED_LANGUAGES],
        preload: [...SUPPORTED_LANGUAGES],
        ns: [...REMOTE_NAMESPACES],
        defaultNS: 'main',
        interpolation: { escapeValue: false },
        backend: {
            loadPath: (languages: string[], namespaces: string[]) => {
                const language = languages[0]
                const namespace = namespaces[0]
                if (!SUPPORTED_LANGUAGES.includes(language as (typeof SUPPORTED_LANGUAGES)[number])) return false
                if (!REMOTE_NAMESPACES.includes(namespace as (typeof REMOTE_NAMESPACES)[number])) return false
                return new URL(`${language}/${namespace}.json`, sourceBaseUrl).toString()
            },
            queryStringParams: { _: String(Date.now()) },
            requestOptions: { signal: AbortSignal.timeout(3000) },
        },
    })

    const resources = {
        en: {
            main: loader.getResourceBundle('en', 'main'),
            renderer: loader.getResourceBundle('en', 'renderer'),
        },
        ru: {
            main: loader.getResourceBundle('ru', 'main'),
            renderer: loader.getResourceBundle('ru', 'renderer'),
        },
    }
    const revision = crypto.createHash('sha256').update(serializeLocalizationRevisionInput({ requiresDesktopApi, resources })).digest('hex')
    const catalog = parseCatalog({
        schemaVersion: LOCALIZATION_CATALOG_SCHEMA_VERSION,
        revision,
        requiresDesktopApi,
        resources,
    })
    if (!catalog) throw new Error('Remote localization resources are incomplete or invalid')
    return catalog
}

export const refreshRemoteLocalization = async (source: MainRendererSource): Promise<void> => {
    const sourceUrl = source.manifest.localizationUrl
    if (!sourceUrl) {
        applyCatalog(null)
        return
    }

    try {
        const catalog = await loadRemoteCatalog(sourceUrl, source.manifest.requiresDesktopApi)
        applyCatalog(catalog)
        await writeCachedCatalog(sourceUrl, catalog).catch(error => logger.main.warn('Failed to cache remote localization', error))
        logger.main.info('Remote localization loaded', { revision: catalog.revision })
        return
    } catch (error) {
        logger.main.warn('Remote localization unavailable; trying cache', {
            message: error instanceof Error ? error.message : String(error),
            url: sourceUrl,
        })
    }

    const cachedCatalog = await readCachedCatalog(sourceUrl)
    applyCatalog(cachedCatalog)
    logger.main.info(cachedCatalog ? 'Cached localization loaded' : 'Bundled localization fallback loaded', {
        revision: cachedCatalog?.revision ?? null,
    })
}

export const getRendererLocalizationSnapshot = (): DesktopLocalizationSnapshot | null => rendererSnapshot

export const registerLocalizationIpc = (): void => {
    if (localizationIpcRegistered) return
    localizationIpcRegistered = true
    ipcMain.on(MainEvents.GET_LOCALIZATION_SNAPSHOT, event => {
        event.returnValue = getRendererLocalizationSnapshot()
    })
}
