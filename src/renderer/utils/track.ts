import { Track } from 'yandex-music-client'

export const getTrackLabel = (track: Track) => {
    return truncate(`${track.title} – ${track.artists.map(a => a.name).join(', ')}`, 45)
}

export const truncate = (str: string, n: number) => {
    return str.length > n ? str.substr(0, n - 1) + '...' : str
}

/**
 * Преобразует строку шестнадцатеричных символов в Uint8Array.
 * @param {string} hexString - Строка, содержащая шестнадцатеричные цифры (например, "a1b2c3...").
 * @returns {Uint8Array} - Массив байтов.
 */
export function hexStringToUint8Array(hexString: string) {
    const hexPairs = hexString.match(/.{1,2}/g)
    const byteValues = hexPairs.map((pair: string) => parseInt(pair, 16))
    return new Uint8Array(byteValues)
}

/**
 * Преобразует число в 16-байтовый массив, используемый в качестве counter для AES-CTR.
 * @param {number} num - Число, которое нужно преобразовать.
 * @returns {Uint8Array} - 16-байтовый массив, заполненный байтами числа.
 */
export function numberToUint8Counter(num: number) {
    let value = num
    const counter = new Uint8Array(16)
    for (let i = 0; i < 16; i++) {
        counter[15 - i] = value & 0xff
        value >>= 8
    }
    return counter
}

/**
 * Асинхронно расшифровывает данные с использованием алгоритма AES-CTR.
 * @param {Object} params - Параметры расшифровки.
 * @param {string} params.key - Ключ в виде шестнадцатеричной строки.
 * @param {ArrayBuffer} params.data - Зашифрованные данные.
 * @returns {Promise<ArrayBuffer>} - Промис, который при разрешении возвращает расшифрованные данные.
 */
export async function decryptData({ key, data: data }: { key: string; data: ArrayBuffer }): Promise<ArrayBuffer> {
    const keyBytes = hexStringToUint8Array(key)
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CTR' }, false, ['encrypt', 'decrypt'])

    let counter = new Uint8Array(16)

    return await crypto.subtle.decrypt(
        {
            name: 'AES-CTR',
            counter: counter,
            length: 128,
        },
        cryptoKey,
        data,
    )
}
