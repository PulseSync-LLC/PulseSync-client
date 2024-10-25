// @ts-ignore
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin'
import CopyWebpackPlugin from 'copy-webpack-plugin'
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin'
import { sentryWebpackPlugin } from '@sentry/webpack-plugin'
import config from './src/config.json'
import webpack from 'webpack'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin')

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
    new NodePolyfillPlugin(),
    sentryWebpackPlugin({
        org: 'pulsesync',
        project: 'electron',
        authToken: config.SENTRY_KEY,
    }),
]
