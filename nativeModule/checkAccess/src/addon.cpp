#include <napi.h>
#include <windows.h>
#include <psapi.h>
#include <vector>
#include <string>

BOOL EnableSeDebugPrivilege() {
    HANDLE hToken;
    TOKEN_PRIVILEGES tp;
    LUID luid;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &hToken))
        return FALSE;
    if (!LookupPrivilegeValue(NULL, SE_DEBUG_NAME, &luid)) {
        CloseHandle(hToken);
        return FALSE;
    }
    tp.PrivilegeCount = 1;
    tp.Privileges[0].Luid = luid;
    tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
    AdjustTokenPrivileges(hToken, FALSE, &tp, sizeof(tp), NULL, NULL);
    BOOL ok = GetLastError() == ERROR_SUCCESS;
    CloseHandle(hToken);
    return ok;
}

namespace discord_check {

const std::vector<std::wstring> discordNames = {
    L"Discord.exe",
    L"DiscordPTB.exe",
    L"DiscordCanary.exe",
    L"DiscordDevelopment.exe",
};

std::wstring GetProcessImagePath(DWORD pid) {
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!hProcess) return L"";
    WCHAR buffer[MAX_PATH];
    DWORD size = MAX_PATH;
    std::wstring result;
    if (QueryFullProcessImageNameW(hProcess, 0, buffer, &size)) {
        result.assign(buffer, size);
    }
    CloseHandle(hProcess);
    return result;
}

bool IsDiscordRunning() {
    DWORD pids[1024], cbNeeded;
    if (!EnumProcesses(pids, sizeof(pids), &cbNeeded)) return false;
    size_t count = cbNeeded / sizeof(DWORD);
    for (size_t i = 0; i < count; ++i) {
        DWORD pid = pids[i];
        if (pid == 0) continue;
        std::wstring path = GetProcessImagePath(pid);
        if (path.empty()) continue;
        size_t pos = path.find_last_of(L"\\/");
        std::wstring name = (pos == std::wstring::npos ? path : path.substr(pos + 1));
        for (const auto& t : discordNames) {
            if (_wcsicmp(name.c_str(), t.c_str()) == 0) {
                return true;
            }
        }
    }
    return false;
}

bool IsAnyDiscordElevated() {
    DWORD pids[1024], cbNeeded;
    if (!EnumProcesses(pids, sizeof(pids), &cbNeeded)) return false;
    size_t count = cbNeeded / sizeof(DWORD);
    for (size_t i = 0; i < count; ++i) {
        DWORD pid = pids[i];
        if (pid == 0) continue;
        std::wstring path = GetProcessImagePath(pid);
        if (path.empty()) continue;
        size_t pos = path.find_last_of(L"\\/");
        std::wstring name = (pos == std::wstring::npos ? path : path.substr(pos + 1));
        for (const auto& t : discordNames) {
            if (_wcsicmp(name.c_str(), t.c_str()) == 0) {
                HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
                if (!hProcess) continue;
                HANDLE hToken = NULL;
                bool elevated = false;
                if (OpenProcessToken(hProcess, TOKEN_QUERY, &hToken)) {
                    TOKEN_ELEVATION elevation;
                    DWORD retLen = 0;
                    if (GetTokenInformation(hToken, TokenElevation, &elevation, sizeof(elevation), &retLen)) {
                        elevated = elevation.TokenIsElevated != 0;
                    }
                    CloseHandle(hToken);
                }
                CloseHandle(hProcess);
                if (elevated) {
                    return true;
                }
            }
        }
    }
    return false;
}

}

static Napi::Boolean Js_IsDiscordRunning(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), discord_check::IsDiscordRunning());
}

static Napi::Boolean Js_IsAnyDiscordElevated(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), discord_check::IsAnyDiscordElevated());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    EnableSeDebugPrivilege();
    exports.Set("isDiscordRunning", Napi::Function::New(env, Js_IsDiscordRunning));
    exports.Set("isAnyDiscordElevated", Napi::Function::New(env, Js_IsAnyDiscordElevated));
    return exports;
}

NODE_API_MODULE(addon, Init)
