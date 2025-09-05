import webpack, { Configuration } from 'webpack'
import { rules } from './webpack.rules'
import path from 'path'
import packageJson from '../package.json'
import { sentryWebpackPlugin } from '@sentry/webpack-plugin'
import config from '../config.json'

const ROOT = path.resolve(__dirname, '..')
const isProd = process.env.NODE_ENV === 'production'

export const mainConfig: Configuration = {
    context: path.resolve(__dirname),
    entry: {
        main: path.resolve(ROOT, 'src/index.ts'),
    },
    target: 'electron-main',
    output: {
        path: path.resolve(ROOT, '.webpack', 'main'),
        filename: pathData => (pathData.chunk.name === 'main' ? 'index.js' : '[name].js'),
        chunkFilename: '[id].js',
    },
    module: { rules },
    plugins: [
        new webpack.DefinePlugin({
            'process.env.BRANCH': JSON.stringify((packageJson as any).buildInfo?.BRANCH),
            'process.env.VERSION': JSON.stringify(packageJson.version),
        }),
        new webpack.SourceMapDevToolPlugin({
            filename: '[file].map',
            moduleFilenameTemplate: (info: { absoluteResourcePath: any }) =>
                'webpack:///' + path.relative(ROOT, info.absoluteResourcePath).replace(/\\/g, '/'),
            fallbackModuleFilenameTemplate: 'webpack:///[resource-path]?[hash]',
            publicPath: '/',
            append: '\n//# sourceMappingURL=[url]',
        }),
        ...(isProd
            ? [
                  sentryWebpackPlugin({
                      org: 'pulsesync',
                      project: 'electron',
                      authToken: (config as any).SENTRY_KEY,
                      debug: false,
                      silent: true,
                      release: {
                          name: 'pulsesync@' + packageJson.version,
                      },
                      sourcemaps: {
                          ignore: ['**/node_modules/**'],
                          filesToDeleteAfterUpload: ['**/*.map'],
                      },
                      reactComponentAnnotation: { enabled: true },
                      errorHandler: err => {
                          console.warn(err)
                      },
                  }),
              ]
            : []),
    ],
    cache: { type: 'filesystem', allowCollectingMemory: true },
    resolve: {
        alias: { '@': path.resolve(ROOT, 'static') },
        extensions: ['.js', '.mjs', '.ts', '.jsx', '.tsx', '.css', '.scss', '.json', '.md', '.svg'],
    },
    externals: [
        'electron',
        'original-fs',
        (data, callback) => {
            const req = data.request as string
            if (req && req.endsWith('.node')) {
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
    devtool: false,
}
