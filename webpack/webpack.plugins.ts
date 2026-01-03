// @ts-ignore
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin'
import CopyWebpackPlugin from 'copy-webpack-plugin'
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin'
import { sentryWebpackPlugin } from '@sentry/webpack-plugin'
import config from '../config.json'
import webpack from 'webpack'
import packageJson from '../package.json'
import path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin')

const ROOT = path.resolve(__dirname, '..')
const isProd = process.env.NODE_ENV === 'production'
const releaseVersion = packageJson.version

export const plugins = [
    new ForkTsCheckerWebpackPlugin({
        logger: 'webpack-infrastructure',
        typescript: {
            configFile: path.join(ROOT, 'tsconfig.json'),
        },
    }),
    new CopyWebpackPlugin({
        patterns: [
            { from: path.join(ROOT, 'static'), to: 'static' },
        ],
    }),
    new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser',
    }),
    new webpack.SourceMapDevToolPlugin({
        filename: '[file].map',
        moduleFilenameTemplate: (info: { absoluteResourcePath: any }) =>
            'webpack:///' + path.relative(ROOT, info.absoluteResourcePath).replace(/\\/g, '/'),
        fallbackModuleFilenameTemplate: 'webpack:///[resource-path]?[hash]',
        publicPath: '/',
        append: '\n//# sourceMappingURL=[url]',
    }),
    new NodePolyfillPlugin(),
    ...(isProd
        ? [
              sentryWebpackPlugin({
                  org: 'pulsesync',
                  project: 'electron',
                  authToken: (config as any).SENTRY_KEY,
                  debug: false,
                  release: {
                      name: 'pulsesync@' + releaseVersion,
                  },
                  sourcemaps: {
                      ignore: ['**/node_modules/**'],
                      filesToDeleteAfterUpload: ['**/*.map'],
                  },
                  reactComponentAnnotation: {
                      enabled: true,
                  },
                  errorHandler: err => {
                      console.warn(err)
                  },
              }),
          ]
        : []),
]
