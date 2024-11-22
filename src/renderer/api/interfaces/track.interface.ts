export default interface TrackInterface {
    state<T>(state: any): [any, any]
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
