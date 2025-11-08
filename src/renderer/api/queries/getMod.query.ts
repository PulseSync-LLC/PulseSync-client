import gql from 'graphql-tag'

export default gql`
    query GetMod {
        getMod {
            id
            musicVersion
            name
            modVersion
            downloadUrl
            downloadUnpackedUrl
            createdAt
            showModal
            shouldReinstall
            checksum
            spoof
            deprecated
        }
    }
`
