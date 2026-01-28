const { convertToCp1251, restoreFromBackup } = require('./license-encoding.cjs')

module.exports = async () => {
    convertToCp1251()
    process.once('exit', restoreFromBackup)
}
