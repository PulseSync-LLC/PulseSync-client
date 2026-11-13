import { desktopApi } from '@shared/desktop/desktopApi'

export const getUserTokenAsync = () => desktopApi.auth.getToken()
