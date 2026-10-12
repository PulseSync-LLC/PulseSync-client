import electron from 'electron'

import path from 'path'

export const TEMP_DIR = electron.app.getPath('temp')
export const CACHE_DIR = path.join(electron.app.getPath('userData'), 'mod-cache')
