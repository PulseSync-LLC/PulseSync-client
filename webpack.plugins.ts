// @ts-ignore
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin'
import CopyWebpackPlugin from 'copy-webpack-plugin'
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin'
import { sentryWebpackPlugin } from '@sentry/webpack-plugin'
import config from './src/config.json'
import webpack from 'webpack'
import packageJson from './package.json'
import path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin')
const releaseVersion = packageJson.version

export const plugins = [
    new ForkTsCheckerWebpackPlugin({
        logger: 'webpack-infrastructure',
    }),
    new CopyWebpackPlugin({
        patterns: [
            { from: 'static', to: 'static' },
            { from: 'static', to: 'main_window/static' },
        ],
    }),
    new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser',
    }),
    new webpack.SourceMapDevToolPlugin({
        filename: '[file].map',
        moduleFilenameTemplate: (info: { absoluteResourcePath: any }) =>
            'webpack:///' + path.relative(__dirname, info.absoluteResourcePath).replace(/\\/g, '/'),
        fallbackModuleFilenameTemplate: 'webpack:///[resource-path]?[hash]',
        publicPath: '~/',
        append: '\n//# sourceMappingURL=[url]',
    }),
    new NodePolyfillPlugin(),
    // sentryWebpackPlugin({
    //     org: 'pulsesync',
    //     project: 'electron',
    //     authToken: config.SENTRY_KEY,
    //     release: {
    //         name: "pulsesync@" + releaseVersion,
    //         uploadLegacySourcemaps: {
    //             paths: [
    //                 path.resolve(__dirname, '.webpack/main'),
    //                 path.resolve(__dirname, '.webpack/renderer'),
    //             ],
    //             urlPrefix: '~/',
    //             stripPrefix: [path.resolve(__dirname, '.webpack')],
    //         },
    //     },
    //     sourcemaps: {
    //         ignore: ['node_modules'],
    //     },
    //     errorHandler: (err) => {
    //         console.warn(err)
    //     },
    // })
]
