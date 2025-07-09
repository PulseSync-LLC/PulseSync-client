import { app, Notification } from 'electron'
import process from 'process'

export function checkCLIArguments(isAppDev: boolean): boolean {
    const args = process.argv.slice(1)
    if (args.length > 0 && !isAppDev) {
        if (args.some(arg => arg.startsWith('pulsesync://') || arg.endsWith('.pext'))) {
            return false
        }
        if (args.includes('--updated')) {
            new Notification({
                title: 'Обновление завершено',
                body: 'Посмотреть список изменений можно в приложении',
            }).show()
            return true
        }
    }
    return false
}
