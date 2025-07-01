import type { Configuration } from 'webpack'
import { rules } from './webpack.rules'
import { plugins } from './webpack.plugins'
import path from 'path'

rules.push({
    test: /\.css$/,
    use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
})

rules.push({
    test: /\.scss$/,
    use: [
        'style-loader',
        {
            loader: 'css-loader',
            options: { modules: { localIdentName: '[name]__[local]___[hash:base64:5]' } },
        },
        'sass-loader',
    ],
})

rules.push({
    test: /\.svg$/,
    use: ['@svgr/webpack'],
})

rules.push({
    test: /\.md$/,
    use: [{ loader: 'html-loader' }, { loader: 'markdown-loader', options: {} }],
})

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
