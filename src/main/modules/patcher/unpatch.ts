import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getPathToYandexMusic, isMac } from '../../utils/appUtils'
import { store } from '../storage'

class UnPatcher {
    static async getAppAsarPath() {
        const appPath = await getPathToYandexMusic()
        return path.join(appPath, 'app.asar')
    }

    static async deleteFiles(filePaths: string[]) {
        const deleteCommands = filePaths.map((filePath) =>
            isMac() ? `rm "${filePath}"` : `del "${filePath}"`,
        )

        deleteCommands.forEach((command) => {
            exec(command, async (error, stdout, stderr) => {
                console.log(`Executing command: ${command}`)
                if (error) {
                    console.error(`Ошибка при удалении файла: ${error}`)
                    return
                }
                if (stderr) {
                    console.error(`Ошибка при выполнении команды: ${stderr}`)
                    return
                }
                console.log(`Файл успешно удален`)
                this.replaceFile(await this.getAppAsarPath())
            })
        })
    }

    static replaceFile(filePath: string) {
        const copyPath = `${filePath}.copy`

        if (!fs.existsSync(copyPath)) {
            console.error(`Файл ${copyPath} не найден`)
            return
        }

        const replaceCommand = isMac()
            ? `mv "${copyPath}" "${filePath}"`
            : `move /Y "${copyPath}" "${filePath}"`

        exec(replaceCommand, (error, stdout, stderr) => {
            console.log(`Executing command: ${replaceCommand}`)
            if (error) {
                console.error(`Ошибка при замене файла: ${error}`)
                return
            }
            if (stderr) {
                console.error(`Ошибка при выполнении команды: ${stderr}`)
                return
            }
            console.log(`Файл ${filePath} успешно заменен`)
        })
    }

    static async unpatch() {
        const appAsarPath = await this.getAppAsarPath()
        await this.deleteFiles([appAsarPath])
        if (isMac()) {
            const appPath = await getPathToYandexMusic()
            const InfoPlist = path.join(appPath, '../', 'Info.plist')
            fs.readFile(InfoPlist, 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading file:', err)
                    return
                }
                const hashRegex = /<key>hash<\/key>\s*<string>([^<]+)<\/string>/
                const match = data.match(hashRegex)

                if (match) {
                    console.log('Old Hash:', match[1])

                    const updatedData = data.replace(
                        hashRegex,
                        `<key>hash<\/key>\n<string>${store.get('music.hash')}<\/string>`,
                    )

                    fs.writeFile(InfoPlist, updatedData, 'utf8', (err) => {
                        if (err) {
                            console.error('Error writing file:', err)
                            return
                        }
                        console.log('File updated successfully')
                    })
                } else {
                    console.error('Hash value not found')
                }
            })
        }
    }
}

export default UnPatcher
