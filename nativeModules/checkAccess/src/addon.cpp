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

std::wstring Utf8ToWide(const std::string& utf8) {
    if (utf8.empty()) return L"";
    int size_needed = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), (int)utf8.size(), NULL, 0);
    std::wstring wide(size_needed, 0);
    MultiByteToWideChar(CP_UTF8, 0, utf8.data(), (int)utf8.size(), &wide[0], size_needed);
    return wide;
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

bool IsProcessRunning(const std::wstring& targetName) {
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
        if (_wcsicmp(name.c_str(), targetName.c_str()) == 0) {
            return true;
        }
    }
    return false;
}

bool IsProcessElevated(const std::wstring& targetName) {
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
        if (_wcsicmp(name.c_str(), targetName.c_str()) == 0) {
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
    return false;
}

}

static Napi::Boolean Js_IsDiscordRunning(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), discord_check::IsDiscordRunning());
}

static Napi::Boolean Js_IsAnyDiscordElevated(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), discord_check::IsAnyDiscordElevated());
}

static Napi::Boolean Js_IsProcessRunning(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }
    std::string name = info[0].As<Napi::String>().Utf8Value();
    std::wstring wname = Utf8ToWide(name);
    bool running = discord_check::IsProcessRunning(wname);
    return Napi::Boolean::New(env, running);
}

static Napi::Boolean Js_IsProcessElevated(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }
    std::string name = info[0].As<Napi::String>().Utf8Value();
    std::wstring wname = Utf8ToWide(name);
    bool elevated = discord_check::IsProcessElevated(wname);
    return Napi::Boolean::New(env, elevated);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    EnableSeDebugPrivilege();
    exports.Set("isDiscordRunning", Napi::Function::New(env, Js_IsDiscordRunning));
    exports.Set("isAnyDiscordElevated", Napi::Function::New(env, Js_IsAnyDiscordElevated));
    exports.Set("isProcessRunning", Napi::Function::New(env, Js_IsProcessRunning));
    exports.Set("isProcessElevated", Napi::Function::New(env, Js_IsProcessElevated));
    return exports;
}

NODE_API_MODULE(addon, Init)