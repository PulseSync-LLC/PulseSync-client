#include "filewatcher.h"
#include <napi.h>
#include <thread>
#include <chrono>
#include <filesystem>
#include <unordered_map>

void Watcher(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string path = info[0].As<Napi::String>().Utf8Value();
    int interval = info[1].As<Napi::Number>().Int32Value();
    Napi::Function jsCallback = info[2].As<Napi::Function>();

    auto tsfn = Napi::ThreadSafeFunction::New(
        env,
        jsCallback,
        "FileWatcher",
        0,
        1
    );

    std::thread([path, interval, tsfn]() mutable {
        namespace fs = std::filesystem;
        std::unordered_map<std::string, fs::file_time_type> files;

        for (auto& entry : fs::recursive_directory_iterator(path)) {
            if (entry.is_regular_file()) {
                auto ext = entry.path().extension();
                if (ext == ".js" || ext == ".css") {
                    files[entry.path().string()] = fs::last_write_time(entry);
                }
            }
        }

        while (true) {
            std::this_thread::sleep_for(std::chrono::milliseconds(interval));
            std::unordered_map<std::string, fs::file_time_type> current;

            for (auto& entry : fs::recursive_directory_iterator(path)) {
                if (entry.is_regular_file()) {
                    auto ext = entry.path().extension();
                    if (ext == ".js" || ext == ".css") {
                        current[entry.path().string()] = fs::last_write_time(entry);
                    }
                }
            }

            for (auto& [file, mtime] : current) {
                auto it = files.find(file);
                if (it == files.end()) {
                    std::string event = "add";
                    tsfn.BlockingCall([file, event](Napi::Env env, Napi::Function callback) {
                        callback.Call({Napi::String::New(env, event), Napi::String::New(env, file)});
                    });
                } else if (mtime != it->second) {
                    std::string event = "change";
                    tsfn.BlockingCall([file, event](Napi::Env env, Napi::Function callback) {
                        callback.Call({Napi::String::New(env, event), Napi::String::New(env, file)});
                    });
                }
            }

            for (auto& [file, mtime] : files) {
                if (current.find(file) == current.end()) {
                    std::string event = "unlink";
                    tsfn.BlockingCall([file, event](Napi::Env env, Napi::Function callback) {
                        callback.Call({Napi::String::New(env, event), Napi::String::New(env, file)});
                    });
                }
            }

            files.swap(current);
        }

        tsfn.Release();
    }).detach();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("watch", Napi::Function::New(env, Watcher));
    return exports;
}

NODE_API_MODULE(filewatcher, Init)