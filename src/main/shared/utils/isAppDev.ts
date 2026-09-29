import { app } from 'electron'

const isAppDev = !app.isPackaged

export default isAppDev
