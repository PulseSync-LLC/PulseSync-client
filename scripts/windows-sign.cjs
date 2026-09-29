const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = async configuration => {
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'windows-sign.ps1'), '-Path', configuration.path], {
        stdio: 'inherit',
        windowsHide: true,
    })
}
