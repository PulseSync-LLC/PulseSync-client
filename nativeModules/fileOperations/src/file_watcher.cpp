#include "file_watcher.h"

#include <cctype>
#include <chrono>
#include <filesystem>
#include <string>
#include <system_error>
#include <thread>
#include <unordered_map>

namespace {

inline std::string ToLower(std::string s) {
    for (auto& ch : s) ch = static_cast<char>(::tolower(static_cast<unsigned char>(ch)));
    return s;
}

std::unordered_map<std::string, std::filesystem::file_time_type> SnapshotDir(const std::filesystem::path& root) {
    namespace fs = std::filesystem;
    std::unordered_map<std::string, fs::file_time_type> out;
    std::error_code ec;
    fs::directory_options opts = fs::directory_options::skip_permission_denied;
    for (fs::recursive_directory_iterator it(root, opts, ec), end; it != end; it.increment(ec)) {
        if (ec) {
            ec.clear();
            continue;
        }
        const fs::directory_entry& entry = *it;
        if (!entry.is_regular_file(ec)) {
            if (ec) ec.clear();
            continue;
        }
#ifdef _WIN32
        auto u8ext = entry.path().extension().u8string();
        std::string ext;
        ext.reserve(u8ext.size());
        for (char8_t c : u8ext) ext.push_back(static_cast<char>(c));
        ext = ToLower(std::move(ext));
#else
        std::string ext = ToLower(entry.path().extension().string());
#endif
        if (ext == ".js" || ext == ".css") {
            auto ft = entry.last_write_time(ec);
            if (ec) { ec.clear(); continue; }
#ifdef _WIN32
            auto u8key = entry.path().generic_u8string();
            std::string key;
            key.reserve(u8key.size());
            for (char8_t c : u8key) key.push_back(static_cast<char>(c));
#else
            std::string key = entry.path().string();
#endif
            out.emplace(std::move(key), ft);
        }
    }
    return out;
}

void Watcher(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 ||
        !info[0].IsString() ||
        !info[1].IsNumber() ||
        !info[2].IsFunction()) {
        Napi::TypeError::New(env, "Expected (path: string, intervalMs: number, callback: function)")
            .ThrowAsJavaScriptException();
        return;
    }
    std::string pathUtf8 = info[0].As<Napi::String>().Utf8Value();
    int interval = info[1].As<Napi::Number>().Int32Value();
    Napi::Function jsCallback = info[2].As<Napi::Function>();
    auto tsfn = Napi::ThreadSafeFunction::New(
        env,
        jsCallback,
        "FileWatcher",
        0,
        1
    );
#ifdef _WIN32
    std::u8string u8path;
    u8path.reserve(pathUtf8.size());
    for (unsigned char c : pathUtf8) u8path.push_back(static_cast<char8_t>(c));
    std::filesystem::path fsPath(u8path);
#else
    std::filesystem::path fsPath(pathUtf8);
#endif
    std::thread([fsPath, interval, tsfn]() mutable {
        namespace fs = std::filesystem;
        auto prev = SnapshotDir(fsPath);
        for (;;) {
            std::this_thread::sleep_for(std::chrono::milliseconds(interval));
            auto cur = SnapshotDir(fsPath);
            for (const auto& kv : cur) {
                const auto& file = kv.first;
                const auto& mtime = kv.second;
                auto it = prev.find(file);
                if (it == prev.end()) {
                    std::string event = "add";
                    napi_status status = tsfn.BlockingCall(
                        [file, event](Napi::Env env, Napi::Function callback) {
                            callback.Call({
                                Napi::String::New(env, event),
                                Napi::String::New(env, file)
                            });
                        }
                    );
                    (void)status;
                } else if (mtime != it->second) {
                    std::string event = "change";
                    napi_status status = tsfn.BlockingCall(
                        [file, event](Napi::Env env, Napi::Function callback) {
                            callback.Call({
                                Napi::String::New(env, event),
                                Napi::String::New(env, file)
                            });
                        }
                    );
                    (void)status;
                }
            }
            for (const auto& kv : prev) {
                const auto& file = kv.first;
                if (cur.find(file) == cur.end()) {
                    std::string event = "unlink";
                    napi_status status = tsfn.BlockingCall(
                        [file, event](Napi::Env env, Napi::Function callback) {
                            callback.Call({
                                Napi::String::New(env, event),
                                Napi::String::New(env, file)
                            });
                        }
                    );
                    (void)status;
                }
            }
            prev.swap(cur);
        }
    }).detach();
}

}  // namespace

void RegisterFileWatcher(Napi::Env env, Napi::Object exports) {
    exports.Set("watch", Napi::Function::New(env, Watcher));
}

