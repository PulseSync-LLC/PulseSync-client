const fs = require('fs')
const os = require('os')
const path = require('path')
const iconv = require('iconv-lite')

const LICENSE_PATH = path.resolve(__dirname, '..', 'license_ru.txt')
const BACKUP_ENV_KEY = 'PULSESYNC_LICENSE_BACKUP'

function log(message) {
    console.log(`[license-encoding] ${message}`)
}

function warn(message) {
    console.warn(`[license-encoding] ${message}`)
}

function convertToCp1251() {
    if (!fs.existsSync(LICENSE_PATH)) {
        warn(`License file not found at ${LICENSE_PATH}, skipping cp-1251 conversion`)
        return
    }
    const originalBuffer = fs.readFileSync(LICENSE_PATH)
    const backupPath = path.join(os.tmpdir(), `pulsesync-license-${process.pid}.bak`)
    fs.writeFileSync(backupPath, originalBuffer)
    process.env[BACKUP_ENV_KEY] = backupPath

    const decoded = iconv.decode(originalBuffer, 'utf-8')
    const encoded = iconv.encode(decoded, 'windows-1251')
    fs.writeFileSync(LICENSE_PATH, encoded)
    log('Converted license_ru.txt to cp-1251 encoding')
}

function restoreFromBackup() {
    const backupPath = process.env[BACKUP_ENV_KEY]
    if (!backupPath) {
        warn('Backup path not set, skipping license restore')
        return
    }
    if (!fs.existsSync(backupPath)) {
        warn(`Backup file not found at ${backupPath}, skipping license restore`)
        return
    }
    const originalBuffer = fs.readFileSync(backupPath)
    fs.writeFileSync(LICENSE_PATH, originalBuffer)
    fs.unlinkSync(backupPath)
    delete process.env[BACKUP_ENV_KEY]
    log('Restored license_ru.txt from backup')
}

module.exports = {
    convertToCp1251,
    restoreFromBackup,
}
