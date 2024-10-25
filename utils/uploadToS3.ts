import * as AWS from 'aws-sdk'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as yaml from 'yaml'
import config from '../src/config.json'

const s3 = new AWS.S3({
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_KEY,
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    s3ForcePathStyle: true,
})

const directoryPath = './release'
const filePath = './release/latest.yml'

fs.readFile(filePath, 'utf8')
    .then(data => {
        const latestYml = yaml.parse(data)

        latestYml.updateUrgency = 'soft'
        latestYml.commonConfig = {
            DEPRECATED_VERSIONS: '<=1.9.0',
            UPDATE_URL: `${config.UPDATE_URL}/beta_build/`,
        }

        const newYaml = yaml.stringify(latestYml)

        return fs.writeFile(filePath, newYaml, 'utf8')
    })
    .then(() => {
        console.log('latest.yml updated successfully!')
        fs.readdir(directoryPath, (err, files) => {
            if (err) {
                console.log('Error reading the directory:', err)
                return
            }

            const filesToUpload = files.filter(
                file =>
                    file === 'latest.yml' ||
                    (file.startsWith('pulse') &&
                        (file.endsWith('.exe') ||
                            file.endsWith('.exe.blockmap'))),
            )

            const latestYmlIndex = filesToUpload.indexOf('latest.yml')
            if (latestYmlIndex > -1) {
                const latestYmlFile = filesToUpload.splice(latestYmlIndex, 1)[0]
                filesToUpload.push(latestYmlFile)
            }

            uploadFilesSequentially(filesToUpload)
        })
    })
    .catch(err => {
        console.error('Error updating latest.yml:', err)
    })

const uploadFilesSequentially = async (files: string[]) => {
    for (const file of files) {
        await uploadFile(file)
    }
}

const uploadFile = (fileName: string) => {
    return new Promise((resolve, reject) => {
        const filePath = path.join(directoryPath, fileName)
        const fileContent = fs.readFileSync(filePath)

        const params = {
            Bucket: config.S3_BUCKET,
            Key: `beta_build/${fileName}`,
            Body: fileContent,
        }

        s3.upload(
            params,
            (err: AWS.AWSError, data: AWS.S3.ManagedUpload.SendData) => {
                if (err) {
                    console.log(`Error uploading file ${fileName}:`, err)
                    reject(err)
                } else {
                    console.log(
                        `File ${fileName} uploaded to S3:`,
                        data.Location,
                    )
                    resolve(data)
                }
            },
        )
    })
}
