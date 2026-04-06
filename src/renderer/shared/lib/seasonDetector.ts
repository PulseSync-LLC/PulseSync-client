export function getSeasonByMSK(): 'summer' | 'winter' | 'default' {
    const mskDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }))

    const month = mskDate.getMonth()

    if (month >= 4 && month <= 8) {
        return 'summer'
    } else if (month >= 9 && month <= 11) {
        return 'winter'
    } else {
        return 'default'
    }
}
