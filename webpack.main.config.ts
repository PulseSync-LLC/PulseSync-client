import type { Configuration } from 'webpack'
import { rules } from './webpack.rules'
import path from 'path'

export const mainConfig: Configuration = {
    entry: './src/index.ts',
    target: 'electron-main',
    module: {
        rules,
    },
    cache: {
        type: 'filesystem',
        allowCollectingMemory: true,
    },
    devtool: 'source-map',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'static'),
        },
        extensions: [
            '.js',
            '.ts',
            '.jsx',
            '.tsx',
            '.css',
            '.scss',
            '.json',
            '.md',
            '.svg',
        ],
    },
    externals: {
        electron: 'electron',
    },
}
