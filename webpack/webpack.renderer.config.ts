import type { Configuration } from 'webpack'
import { rules } from './webpack.rules'
import { plugins } from './webpack.plugins'
import path from 'path'

export const rendererConfig: Configuration = {
    context: path.resolve(__dirname),
    module: { rules },
    plugins,
    devtool: 'source-map',
    optimization: {
        splitChunks: {
            chunks: 'async',
            minSize: 10000,
            minRemainingSize: 0,
            minChunks: 1,
            maxAsyncRequests: 30,
            maxInitialRequests: 30,
            enforceSizeThreshold: 50000,
            cacheGroups: {
                defaultVendors: {
                    test: /[\\/]node_modules[\\/]/,
                    priority: -10,
                    reuseExistingChunk: true,
                },
                default: {
                    minChunks: 2,
                    priority: -20,
                    reuseExistingChunk: true,
                },
            },
        },
    },
    resolve: {
        fallback: {
            crypto: require.resolve('crypto-browserify'),
            stream: require.resolve('stream-browserify'),
            buffer: require.resolve('buffer'),
            assert: require.resolve('assert'),
            util: require.resolve('util'),
            http: require.resolve('stream-http'),
            https: require.resolve('https-browserify'),
            url: require.resolve('url'),
            process: require.resolve('process/browser'),
        },
        extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
    },
}
