import webpack, { Configuration } from 'webpack'
import { rules } from './webpack.rules'
import path from 'path'
import packageJson from './package.json'

export const mainConfig: Configuration = {
    context: path.resolve(__dirname),
    entry: {
        main: path.resolve(__dirname, 'src/index.ts'),
    },
    target: 'electron-main',
    output: {
        path: path.resolve(__dirname, '.webpack', 'main'),
        filename: pathData => (pathData.chunk.name === 'main' ? 'index.js' : '[name].js'),
        chunkFilename: '[id].js',
    },
    module: { rules },
    plugins: [
        new webpack.DefinePlugin({
            'process.env.BRANCH': JSON.stringify(packageJson.buildInfo?.BRANCH),
            'process.env.VERSION': JSON.stringify(packageJson.version),
        }),
    ],
    cache: { type: 'filesystem', allowCollectingMemory: true },
    resolve: {
        alias: { '@': path.resolve(__dirname, 'static') },
        extensions: ['.js', '.mjs', '.ts', '.jsx', '.tsx', '.css', '.scss', '.json', '.md', '.svg'],
    },
    externals: [
        'electron',
        (data, callback) => {
            const req = data.request as string
            if (req.endsWith('.node')) {
                return callback(null, 'commonjs2 ' + req)
            }
            callback()
        },
    ],
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
