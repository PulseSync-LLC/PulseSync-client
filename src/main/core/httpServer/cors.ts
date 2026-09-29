export const buildCorsHeaders = (origin: string | undefined, allowedOrigins: string[]): Record<string, string> => {
    if (origin && allowedOrigins.includes(origin)) {
        return {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Credentials': 'true',
        }
    }

    return {
        'Access-Control-Allow-Origin': '*',
    }
}
