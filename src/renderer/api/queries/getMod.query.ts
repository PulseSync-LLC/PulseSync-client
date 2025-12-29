import gql from 'graphql-tag'

export default gql`
    query GetMod {
        getMod {
            id
            musicVersion
            realMusicVersion
            name
            modVersion
            downloadUrl
            downloadUnpackedUrl
            unpackedChecksum
            createdAt
            showModal
            shouldReinstall
            checksum
            spoof
            deprecated
        }
    }
`
