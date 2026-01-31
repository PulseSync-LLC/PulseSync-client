#include <napi.h>

#include "file_ops.h"
#include "file_watcher.h"

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    RegisterFileOperations(env, exports);
    RegisterFileWatcher(env, exports);
    return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)
