export function getSeasonByMSK(): 'summer' | 'winter' {
    const mskDate = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })
    );

    const month = mskDate.getMonth();

    return month >= 4 && month <= 8 ? 'summer' : 'winter';
}

