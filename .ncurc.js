module.exports = {
    filterResults: (name, semver) => {
        return !(name === '@vercel/webpack-asset-relocator-loader' && semver.upgradedVersion > '1.7.3')
    },
}
