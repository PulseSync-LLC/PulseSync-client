#include "file_ops.h"

#include <algorithm>
#include <limits>
#include <string>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <cerrno>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace {

std::string GetLastErrorMessage() {
#ifdef _WIN32
    DWORD err = GetLastError();
    if (err == 0) return std::string();

    LPWSTR buf = nullptr;
    DWORD len = FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr,
        err,
        MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
        (LPWSTR)&buf,
        0,
        nullptr
    );

    if (len == 0 || buf == nullptr) {
        return std::string("WinAPI error code: ") + std::to_string(err);
    }

    int size = WideCharToMultiByte(
        CP_UTF8,
        0,
        buf,
        static_cast<int>(len),
        nullptr,
        0,
        nullptr,
        nullptr
    );

    if (size <= 0) {
        LocalFree(buf);
        return std::string("WinAPI error code: ") + std::to_string(err);
    }

    std::string result(size, 0);
    WideCharToMultiByte(
        CP_UTF8,
        0,
        buf,
        static_cast<int>(len),
        &result[0],
        size,
        nullptr,
        nullptr
    );

    LocalFree(buf);

    while (!result.empty() && (result.back() == '\r' || result.back() == '\n')) {
        result.pop_back();
    }

    return result;
#else
    int err = errno;
    const char* msg = strerror(err);
    if (!msg) return std::string("errno: ") + std::to_string(err);
    return std::string(msg);
#endif
}

void ThrowFsError(Napi::Env env, const std::string& prefix) {
    std::string msg = prefix;
    std::string osErr = GetLastErrorMessage();
    if (!osErr.empty()) {
        msg += ": ";
        msg += osErr;
    }
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
}

#ifdef _WIN32
std::wstring Utf8ToWide(const std::string& s) {
    if (s.empty()) return std::wstring();
    int size = MultiByteToWideChar(
        CP_UTF8,
        0,
        s.c_str(),
        static_cast<int>(s.size()),
        nullptr,
        0
    );
    if (size <= 0) {
        return std::wstring();
    }
    std::wstring result(size, 0);
    MultiByteToWideChar(
        CP_UTF8,
        0,
        s.c_str(),
        static_cast<int>(s.size()),
        &result[0],
        size
    );
    return result;
}

bool RemoveDirectoryRecursiveW(const std::wstring& path) {
    WIN32_FIND_DATAW findData;
    HANDLE findHandle = FindFirstFileW((path + L"\\*").c_str(), &findData);

    if (findHandle == INVALID_HANDLE_VALUE) {
        return false;
    }

    bool success = true;
    do {
        std::wstring fileName = findData.cFileName;
        if (fileName == L"." || fileName == L"..") {
            continue;
        }

        std::wstring fullPath = path + L"\\" + fileName;

        if (findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            if (!RemoveDirectoryRecursiveW(fullPath)) {
                success = false;
                break;
            }
        } else {
            if (!DeleteFileW(fullPath.c_str())) {
                success = false;
                break;
            }
        }
    } while (FindNextFileW(findHandle, &findData));

    FindClose(findHandle);

    if (success && !RemoveDirectoryW(path.c_str())) {
        return false;
    }

    return success;
}
#else
bool RemoveDirectoryRecursive(const std::string& path) {
    DIR* dir = opendir(path.c_str());
    if (!dir) {
        return false;
    }

    bool success = true;
    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        std::string fileName = entry->d_name;
        if (fileName == "." || fileName == "..") {
            continue;
        }

        std::string fullPath = path + "/" + fileName;
        struct stat st;

        if (stat(fullPath.c_str(), &st) != 0) {
            success = false;
            break;
        }

        if (S_ISDIR(st.st_mode)) {
            if (!RemoveDirectoryRecursive(fullPath)) {
                success = false;
                break;
            }
        } else {
            if (unlink(fullPath.c_str()) != 0) {
                success = false;
                break;
            }
        }
    }

    closedir(dir);

    if (success && rmdir(path.c_str()) != 0) {
        return false;
    }

    return success;
}
#endif

Napi::Value FileExistsWrapped(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Path must be a string").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string path = info[0].As<Napi::String>().Utf8Value();

#ifdef _WIN32
    std::wstring wpath = Utf8ToWide(path);
    if (wpath.empty()) {
        return Napi::Boolean::New(env, false);
    }
    DWORD attrs = GetFileAttributesW(wpath.c_str());
    if (attrs == INVALID_FILE_ATTRIBUTES) {
        return Napi::Boolean::New(env, false);
    }
    return Napi::Boolean::New(env, true);
#else
    struct stat st;
    if (stat(path.c_str(), &st) == 0) {
        return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
#endif
}

Napi::Value ReadFileWrapped(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Path must be a string").ThrowAsJavaScriptException();
        return env.Null();
    }
    std::string path = info[0].As<Napi::String>().Utf8Value();

#ifdef _WIN32
    std::wstring wpath = Utf8ToWide(path);
    if (wpath.empty()) {
        ThrowFsError(env, "Failed to convert path to wide string");
        return env.Null();
    }

    HANDLE h = CreateFileW(
        wpath.c_str(),
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr
    );
    if (h == INVALID_HANDLE_VALUE) {
        ThrowFsError(env, "Failed to open file for read");
        return env.Null();
    }

    LARGE_INTEGER size;
    if (!GetFileSizeEx(h, &size)) {
        CloseHandle(h);
        ThrowFsError(env, "Failed to get file size");
        return env.Null();
    }

    if (size.QuadPart < 0) {
        CloseHandle(h);
        Napi::Error::New(env, "Negative file size").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (size.QuadPart > static_cast<LONGLONG>(std::numeric_limits<size_t>::max())) {
        CloseHandle(h);
        Napi::Error::New(env, "File too large").ThrowAsJavaScriptException();
        return env.Null();
    }

    size_t sz = static_cast<size_t>(size.QuadPart);
    std::vector<uint8_t> buf;
    buf.resize(sz);

    DWORD totalRead = 0;
    while (totalRead < sz) {
        DWORD toRead = static_cast<DWORD>(std::min<size_t>(sz - totalRead, 64 * 1024 * 1024));
        DWORD readNow = 0;
        BOOL ok = ReadFile(h, buf.data() + totalRead, toRead, &readNow, nullptr);
        if (!ok) {
            CloseHandle(h);
            ThrowFsError(env, "Failed to read file");
            return env.Null();
        }
        if (readNow == 0) break;
        totalRead += readNow;
    }

    CloseHandle(h);
    return Napi::Buffer<uint8_t>::Copy(env, buf.data(), totalRead);
#else
    int fd = open(path.c_str(), O_RDONLY);
    if (fd < 0) {
        ThrowFsError(env, "Failed to open file for read");
        return env.Null();
    }

    struct stat st;
    if (fstat(fd, &st) != 0) {
        int savedErr = errno;
        close(fd);
        errno = savedErr;
        ThrowFsError(env, "Failed to stat file");
        return env.Null();
    }

    if (!S_ISREG(st.st_mode)) {
        close(fd);
        Napi::Error::New(env, "Not a regular file").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (st.st_size < 0) {
        close(fd);
        Napi::Error::New(env, "Negative file size").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (static_cast<unsigned long long>(st.st_size) >
        static_cast<unsigned long long>(std::numeric_limits<size_t>::max())) {
        close(fd);
        Napi::Error::New(env, "File too large").ThrowAsJavaScriptException();
        return env.Null();
    }

    size_t sz = static_cast<size_t>(st.st_size);
    std::vector<uint8_t> buf;
    buf.resize(sz);

    size_t totalRead = 0;
    while (totalRead < sz) {
        ssize_t r = read(fd, buf.data() + totalRead, sz - totalRead);
        if (r < 0) {
            int savedErr = errno;
            close(fd);
            errno = savedErr;
            ThrowFsError(env, "Failed to read file");
            return env.Null();
        }
        if (r == 0) break;
        totalRead += static_cast<size_t>(r);
    }

    close(fd);
    return Napi::Buffer<uint8_t>::Copy(env, buf.data(), totalRead);
#endif
}

Napi::Value DeleteFileWrapped(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Path must be a string").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string path = info[0].As<Napi::String>().Utf8Value();

#ifdef _WIN32
    std::wstring wpath = Utf8ToWide(path);
    if (wpath.empty()) {
        ThrowFsError(env, "Failed to convert path to wide string");
        return env.Null();
    }

    DWORD attrs = GetFileAttributesW(wpath.c_str());
    if (attrs == INVALID_FILE_ATTRIBUTES) {
        ThrowFsError(env, "Path does not exist");
        return env.Null();
    }

    if (attrs & FILE_ATTRIBUTE_DIRECTORY) {
        if (!RemoveDirectoryRecursiveW(wpath)) {
            ThrowFsError(env, "Failed to delete directory");
            return env.Null();
        }
    } else {
        if (!DeleteFileW(wpath.c_str())) {
            ThrowFsError(env, "Failed to delete file");
            return env.Null();
        }
    }
#else
    struct stat st;
    if (stat(path.c_str(), &st) != 0) {
        ThrowFsError(env, "Path does not exist");
        return env.Null();
    }

    if (S_ISDIR(st.st_mode)) {
        if (!RemoveDirectoryRecursive(path)) {
            ThrowFsError(env, "Failed to delete directory");
            return env.Null();
        }
    } else {
        if (unlink(path.c_str()) != 0) {
            ThrowFsError(env, "Failed to delete file");
            return env.Null();
        }
    }
#endif

    return env.Undefined();
}

Napi::Value RenameFileWrapped(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Old and new path must be strings").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string oldPath = info[0].As<Napi::String>().Utf8Value();
    std::string newPath = info[1].As<Napi::String>().Utf8Value();

#ifdef _WIN32
    std::wstring wold = Utf8ToWide(oldPath);
    std::wstring wnew = Utf8ToWide(newPath);
    if (wold.empty() || wnew.empty()) {
        ThrowFsError(env, "Failed to convert path to wide string");
        return env.Null();
    }

    BOOL ok = MoveFileExW(
        wold.c_str(),
        wnew.c_str(),
        MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED
    );
    if (!ok) {
        ThrowFsError(env, "Failed to rename file");
        return env.Null();
    }
#else
    if (rename(oldPath.c_str(), newPath.c_str()) != 0) {
        ThrowFsError(env, "Failed to rename file");
        return env.Null();
    }
#endif

    return env.Undefined();
}

#ifndef _WIN32
bool CopyFilePosix(const std::string& src, const std::string& dst, std::string& errMsg) {
    int inFd = open(src.c_str(), O_RDONLY);
    if (inFd < 0) {
        errMsg = GetLastErrorMessage();
        return false;
    }

    struct stat st;
    if (fstat(inFd, &st) != 0) {
        int savedErr = errno;
        close(inFd);
        errno = savedErr;
        errMsg = GetLastErrorMessage();
        return false;
    }

    mode_t mode = st.st_mode & 0777;
    int outFd = open(dst.c_str(), O_WRONLY | O_CREAT | O_TRUNC, mode);
    if (outFd < 0) {
        int savedErr = errno;
        close(inFd);
        errno = savedErr;
        errMsg = GetLastErrorMessage();
        return false;
    }

    const size_t bufSize = 65536;
    std::vector<char> buf(bufSize);

    while (true) {
        ssize_t r = read(inFd, buf.data(), bufSize);
        if (r < 0) {
            int savedErr = errno;
            close(inFd);
            close(outFd);
            errno = savedErr;
            errMsg = GetLastErrorMessage();
            return false;
        }
        if (r == 0) break;

        ssize_t off = 0;
        while (off < r) {
            ssize_t w = write(outFd, buf.data() + off, r - off);
            if (w < 0) {
                int savedErr = errno;
                close(inFd);
                close(outFd);
                errno = savedErr;
                errMsg = GetLastErrorMessage();
                return false;
            }
            off += w;
        }
    }

    if (close(inFd) != 0) {
        int savedErr = errno;
        close(outFd);
        errno = savedErr;
        errMsg = GetLastErrorMessage();
        return false;
    }

    if (close(outFd) != 0) {
        errMsg = GetLastErrorMessage();
        return false;
    }

    return true;
}
#endif

Napi::Value MoveFileWrapped(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Source and destination path must be strings").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string src = info[0].As<Napi::String>().Utf8Value();
    std::string dst = info[1].As<Napi::String>().Utf8Value();

#ifdef _WIN32
    std::wstring wsrc = Utf8ToWide(src);
    std::wstring wdst = Utf8ToWide(dst);
    if (wsrc.empty() || wdst.empty()) {
        ThrowFsError(env, "Failed to convert path to wide string");
        return env.Null();
    }

    BOOL ok = MoveFileExW(
        wsrc.c_str(),
        wdst.c_str(),
        MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED
    );
    if (!ok) {
        ThrowFsError(env, "Failed to move file");
        return env.Null();
    }
#else
    if (rename(src.c_str(), dst.c_str()) == 0) {
        return env.Undefined();
    }

    if (errno != EXDEV) {
        ThrowFsError(env, "Failed to move file");
        return env.Null();
    }

    std::string msg;
    if (!CopyFilePosix(src, dst, msg)) {
        Napi::Error::New(env, std::string("Failed to move file (copy phase): ") + msg).ThrowAsJavaScriptException();
        return env.Null();
    }

    if (unlink(src.c_str()) != 0) {
        ThrowFsError(env, "Failed to remove source after move");
        return env.Null();
    }
#endif

    return env.Undefined();
}

}  // namespace

void RegisterFileOperations(Napi::Env env, Napi::Object exports) {
    exports.Set("fileExists", Napi::Function::New(env, FileExistsWrapped));
    exports.Set("readFile", Napi::Function::New(env, ReadFileWrapped));
    exports.Set("deleteFile", Napi::Function::New(env, DeleteFileWrapped));
    exports.Set("renameFile", Napi::Function::New(env, RenameFileWrapped));
    exports.Set("moveFile", Napi::Function::New(env, MoveFileWrapped));
}

