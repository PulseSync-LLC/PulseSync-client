import type { ModuleOptions } from 'webpack'

export const rules: Required<ModuleOptions>['rules'] = [
    {
        test: /\.(js|jsx)$/,
        exclude: /(node_modules|\.webpack)/,
        use: {
            loader: 'babel-loader',
            options: {
                cacheDirectory: true,
                presets: ['@babel/preset-env', '@babel/preset-react'],
            },
        },
    },
    {
        test: /\.tsx?$/,
        exclude: /(node_modules|\.webpack)/,
        use: [
            {
                loader: 'babel-loader',
                options: {
                    cacheDirectory: true,
                    presets: ['@babel/preset-env', '@babel/preset-typescript', '@babel/preset-react'],
                },
            },
            {
                loader: 'ts-loader',
                options: {
                    transpileOnly: true,
                },
            },
        ],
    },
    {
        test: /native_modules[/\\].+\.node$/,
        use: 'node-loader',
    },
    {
        test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
        parser: { amd: true },
        use: {
            loader: '@vercel/webpack-asset-relocator-loader',
            options: {
                outputAssetBase: 'native_modules',
            },
        },
    },
    {
        test: /\.(wav|mp3|ogg|mpe?g)$/i,
        loader: 'file-loader',
        options: {
            name: '[path][name].[ext]',
        },
    },
    {
        test: /\.mjs$/,
        include: /node_modules/,
        type: 'javascript/auto',
    },
    {
        test: /\.m?js$/,
        resolve: { fullySpecified: false },
    },
]
