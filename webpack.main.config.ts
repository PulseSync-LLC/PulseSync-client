import type { Configuration } from 'webpack'
import { rules } from './webpack.rules'
import path from 'path'

export const mainConfig: Configuration = {
    entry: {
        main: './src/index.ts',
    },
    target: 'electron-main',
    output: {
        path: path.resolve(__dirname, '.webpack', 'main'),
        filename: pathData => {
            if (pathData.chunk.name === 'main') {
                return 'index.js'
            }
            return '[name].js'
        },
        chunkFilename: '[id].js',
    },
    module: {
        rules,
    },
    cache: {
        type: 'filesystem',
        allowCollectingMemory: true,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'static'),
        },
        extensions: ['.js', '.mjs', '.ts', '.jsx', '.tsx', '.css', '.scss', '.json', '.md', '.svg'],
    },
    externals: {
        electron: 'electron',
    },
    optimization: {
        splitChunks: {
            chunks: 'async',
            cacheGroups: {
                vendors: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    chunks: 'all',
                    enforce: true,
                },
            },
        },
    },
}
