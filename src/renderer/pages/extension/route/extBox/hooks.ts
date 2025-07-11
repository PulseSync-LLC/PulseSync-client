import { useEffect, useState } from 'react'
import path from 'path'
import { DocTab } from './types'
import { AddonConfig } from '../../../../components/сonfigurationSettings/types'
import AddonInterface from '../../../../api/interfaces/addon.interface'

export function useAddonFiles(addon: AddonInterface | null) {
  const [docs,         setDocs]      = useState<DocTab[]>([])
  const [config,       setConfig]    = useState<AddonConfig | null>(null)
  const [configExists, setCfgExists] = useState<boolean | null>(null)

  useEffect(() => {
    if (!addon) return
    const dir = addon.path

    const loadDocs = async () => {
      try {
        const res = await window.desktopEvents.invoke('file-event', 'read-dir', dir)
        if (!res?.success) throw new Error(res.error || 'read-dir failed')

        const entries: string[] = res.entries
        const files = entries
          .filter(n => n.toLowerCase().endsWith('.md') || n.toLowerCase() === 'license')
          .sort((a, b) => {
            const order = (name: string) => {
              if (/^readme\.md$/i.test(name)) return 0
              if (/^license$/i.test(name))    return 1
              return 2
            }
            return order(a.toLowerCase()) - order(b.toLowerCase()) || a.localeCompare(b)
          })

        const loaded: DocTab[] = []
        for (const name of files) {
          const filePath = path.join(dir, name)
          const text = await window.desktopEvents.invoke('file-event', 'read-file', filePath)
          loaded.push({
            title: prettifyFileName(name),
            content: String(text ?? ''),
            isMarkdown: name.toLowerCase().endsWith('.md'),
          })
        }
        setDocs(loaded)
      } catch (e) {
        console.error('loadDocs error', e)
        setDocs([])
      }
    }

    const loadConfig = async () => {
      const cfgPath = path.join(dir, 'handleEvents.json')
      const exists  = await window.desktopEvents.invoke('file-event', 'check-file-exists', cfgPath)
      setCfgExists(Boolean(exists))

      if (exists) {
        const txt = await window.desktopEvents.invoke('file-event', 'read-file', cfgPath)
        try   { setConfig(JSON.parse(txt)) }
        catch { setConfig(null) }
      } else {
        setConfig(null)
      }
    }

    loadDocs()
    loadConfig()
  }, [addon])

  return { docs, config, configExists, setConfig }
}

function prettifyFileName(name: string) {
  const noExt = name.replace(/\.md$/i, '')
  if (noExt.toLowerCase() === 'license') return 'License'
  return noExt
    .replace(/[-_]+/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
}
