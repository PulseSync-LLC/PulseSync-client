#!/usr/bin/env node

const chunks = []

process.stdin.on('data', chunk => chunks.push(chunk))
process.stdin.on('end', () => {
    const input = Buffer.concat(chunks).toString('utf8')

    try {
        const packageJson = JSON.parse(input)
        delete packageJson.buildInfo
        process.stdout.write(`${JSON.stringify(packageJson, null, 4)}\n`)
    } catch {
        process.stdout.write(input)
    }
})
