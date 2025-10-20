import type { ModuleOptions } from 'webpack'

export const rules: Required<ModuleOptions>['rules'] = [
    {
        test: /\.[mc]?[jt]sx?$/i,
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
    {
        test: /\.scss$/,
        use: [
            'style-loader',
            {
                loader: 'css-loader',
                options: { modules: { localIdentName: '[name]__[local]___[hash:base64:5]' } },
            },
            'sass-loader',
        ],
    },
    {
        test: /\.svg$/,
        use: ['@svgr/webpack'],
    },

    {
        test: /\.(gif)$/i,
        use: [
            {
                loader: 'file-loader',
                options: {
                    name: 'assets/[name].[contenthash:8].[ext]',
                    esModule: false,
                },
            },
            {
                loader: 'image-webpack-loader',
                options: {
                    mozjpeg: { progressive: true, quality: 75 },
                    optipng: { optimizationLevel: 5 },
                    pngquant: { quality: [0.65, 0.9], speed: 4 },
                    gifsicle: { interlaced: false, optimizationLevel: 3 },
                },
            },
        ],
    },

    {
        test: /\.md$/,
        use: [{ loader: 'html-loader' }, { loader: 'markdown-loader', options: {} }],
    },
    {
        test: /\.css$/,
        use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
    },
]
