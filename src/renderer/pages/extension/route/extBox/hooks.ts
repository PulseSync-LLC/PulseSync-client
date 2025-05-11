import { useEffect, useState } from 'react'
import path from 'path'
import { AddonConfig } from '../../../../components/сonfigurationSettings/types'
import AddonInterface from '../../../../api/interfaces/addon.interface'

export function useAddonFiles(addon: AddonInterface | null) {
  const [markdown, setMarkdown]       = useState('')
  const [config,   setConfig]         = useState<AddonConfig | null>(null)
  const [configExists, setCfgExists]  = useState<boolean | null>(null)

  useEffect(() => {
    if (!addon) return

    fetch(`${addon.path}/README.md`)
      .then(r => r.text())
      .then(setMarkdown)
      .catch(() => setMarkdown(''))

    const loadConfig = async () => {
      const cfgPath = path.join(addon.path, 'handleEvents.json')
      const exists  = await window.desktopEvents?.invoke('file-event', 'check-file-exists', cfgPath)
      setCfgExists(exists)
      if (exists) {
        const text = await window.desktopEvents?.invoke('file-event', 'read-file', cfgPath)
        try   { setConfig(JSON.parse(text)) }
        catch { setConfig(null) }
      } else {
        setConfig(null)
      }
    }
    loadConfig()
  }, [addon])

  return { markdown, config, configExists, setConfig }
}
