import webpack, { Configuration } from 'webpack'
import { rules } from './webpack.rules'
import path from 'path'
import packageJson from './package.json'

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
    plugins: [
        new webpack.DefinePlugin({
            'process.env.BRANCH':  JSON.stringify(packageJson.buildInfo?.BRANCH),
            'process.env.VERSION': JSON.stringify(packageJson.version),
        }),
    ],
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
