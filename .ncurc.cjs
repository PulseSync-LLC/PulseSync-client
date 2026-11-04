module.exports = {
    target: name => (name === '@types/node' ? 'semver' : 'latest'),
}
