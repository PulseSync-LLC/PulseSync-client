export default interface TrackInterface {
    playerBarTitle: string
    artist: string
    album: string
    timecodes: string[]
    requestImgTrack: (string | null)[]
    linkTitle: string
    id?: string
    url?: string,
    status?: string
}
