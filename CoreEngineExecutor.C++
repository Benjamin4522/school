/*
 * BEULROCK RTAS v2.0 - APEX PREDATOR
 * Native Execution Core with Pre-fork Pool, Shared Memory IPC, LuaJIT, Plugin System
 * 
 * Compile:
 *   g++ -O3 -std=c++20 -static -o core_engine_v2 core_engine_v2.cpp \
 *       -lpthread -ldl -lluajit-5.1 -lrt -I/usr/include/luajit-2.1
 *
 * Dependencies: libluajit-5.1-dev, libdl
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#include <map>
#include <functional>
#include <atomic>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <chrono>
#include <csignal>

#include <unistd.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <dlfcn.h>

// LuaJIT
extern "C" {
    #include <luajit-2.1/lua.h>
    #include <luajit-2.1/lualib.h>
    #include <luajit-2.1/lauxlib.h>
}

// ============================================================
// CONFIGURATION
// ============================================================
static constexpr int MAX_WORKERS = 16;
static constexpr int MAX_JOB_QUEUE = 256;
static constexpr size_t SHARED_MEM_SIZE = 64 * 1024 * 1024; // 64 MB
static constexpr const char* SOCKET_PATH = "/tmp/beulrock_core.sock";
static constexpr const char* PLUGIN_DIR = "/opt/beulrock/plugins";
static constexpr int WATCHDOG_TIMEOUT_SEC = 10;
static constexpr size_t MAX_OUTPUT_PER_JOB = 10 * 1024 * 1024; // 10 MB

// ============================================================
// JOB STRUCTURE (Shared Memory)
// ============================================================
struct JobRequest {
    uint64_t id;
    uint32_t type; // 0=Shell, 1=LuaJIT, 2=Plugin
    uint32_t payload_len;
    char payload[]; // Flexible array member
};

struct JobResponse {
    uint64_t id;
    int32_t exit_code;
    uint32_t output_len;
    char output[];
};

// ============================================================
// PLUGIN INTERFACE
// ============================================================
typedef int (*plugin_execute_t)(const char* input, char** output);

struct PluginHandle {
    void* dl_handle;
    plugin_execute_t execute;
};

// ============================================================
// GLOBAL STATE
// ============================================================
static std::atomic<bool> g_running{true};
static std::atomic<int> g_active_jobs{0};
static std::map<std::string, PluginHandle> g_plugins;
static std::mutex g_plugin_mutex;

// Process pool
struct WorkerProcess {
    pid_t pid;
    int stdin_pipe[2];
    int stdout_pipe[2];
};
static WorkerProcess g_workers[MAX_WORKERS];
static int g_worker_count = 0;

// Job queue
static std::queue<JobRequest*> g_job_queue;
static std::mutex g_queue_mutex;
static std::condition_variable g_queue_cv;

// ============================================================
// LUAJIT EXECUTION ENGINE
// ============================================================
static int execute_luajit(const std::string& script, std::string& output) {
    lua_State* L = luaL_newstate();
    if (!L) {
        output = "[ERROR] Failed to create LuaJIT state";
        return -1;
    }
    luaL_openlibs(L);

    // Set memory limit (256 MB)
    lua_gc(L, LUA_GCSETMEMLIMIT, 256 * 1024 * 1024);

    int ret = 0;
    // Capture print output
    lua_pushcfunction(L, [](lua_State* L) -> int {
        const char* msg = lua_tostring(L, 1);
        lua_getglobal(L, "__output");
        lua_pushstring(L, msg);
        lua_pushstring(L, "\n");
        lua_concat(L, 2);
        lua_concat(L, 2);
        lua_setglobal(L, "__output");
        return 0;
    });
    lua_setglobal(L, "print");

    lua_pushstring(L, "");
    lua_setglobal(L, "__output");

    if (luaL_loadstring(L, script.c_str()) != LUA_OK) {
        output = std::string("[ERROR] Lua compile: ") + lua_tostring(L, -1);
        ret = -1;
    } else if (lua_pcall(L, 0, 0, 0) != LUA_OK) {
        output = std::string("[ERROR] Lua runtime: ") + lua_tostring(L, -1);
        ret = -1;
    } else {
        lua_getglobal(L, "__output");
        output = lua_tostring(L, -1);
    }

    lua_close(L);
    return ret;
}

// ============================================================
// PLUGIN LOADER
// ============================================================
static void load_plugins() {
    DIR* dir = opendir(PLUGIN_DIR);
    if (!dir) return;

    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        std::string name = entry->d_name;
        if (name.size() < 4 || name.substr(name.size() - 3) != ".so") continue;

        std::string path = std::string(PLUGIN_DIR) + "/" + name;
        void* handle = dlopen(path.c_str(), RTLD_NOW);
        if (!handle) {
            fprintf(stderr, "[PLUGIN] Failed to load %s: %s\n", name.c_str(), dlerror());
            continue;
        }

        auto execute = (plugin_execute_t)dlsym(handle, "execute");
        if (!execute) {
            fprintf(stderr, "[PLUGIN] No 'execute' symbol in %s\n", name.c_str());
            dlclose(handle);
            continue;
        }

        std::lock_guard<std::mutex> lock(g_plugin_mutex);
        g_plugins[name] = {handle, execute};
        fprintf(stderr, "[PLUGIN] Loaded: %s\n", name.c_str());
    }
    closedir(dir);
}

// ============================================================
// WORKER PROCESS HANDLER
// ============================================================
static void spawn_worker(int index) {
    int stdin_fd[2], stdout_fd[2];
    pipe(stdin_fd);
    pipe(stdout_fd);

    pid_t pid = fork();
    if (pid == 0) {
        // Child
        close(stdin_fd[1]);
        close(stdout_fd[0]);
        dup2(stdin_fd[0], STDIN_FILENO);
        dup2(stdout_fd[1], STDOUT_FILENO);
        close(stdin_fd[0]);
        close(stdout_fd[1]);

        // Set resource limits
        rlimit cpu_lim{WATCHDOG_TIMEOUT_SEC, WATCHDOG_TIMEOUT_SEC};
        rlimit mem_lim{512 * 1024 * 1024, 512 * 1024 * 1024};
        setrlimit(RLIMIT_CPU, &cpu_lim);
        setrlimit(RLIMIT_AS, &mem_lim);

        // Simple loop: read job, execute, write response
        while (true) {
            uint32_t type, payload_len;
            if (read(STDIN_FILENO, &type, sizeof(type)) <= 0) break;
            if (read(STDIN_FILENO, &payload_len, sizeof(payload_len)) <= 0) break;

            std::vector<char> payload(payload_len);
            if (read(STDIN_FILENO, payload.data(), payload_len) <= 0) break;

            std::string output;
            int exit_code = 0;

            if (type == 0) {
                // Shell execution
                FILE* pipe = popen(payload.data(), "r");
                if (pipe) {
                    char buf[4096];
                    while (fgets(buf, sizeof(buf), pipe)) output += buf;
                    int status = pclose(pipe);
                    exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
                } else {
                    output = "[ERROR] popen failed";
                    exit_code = -1;
                }
            } else if (type == 1) {
                // LuaJIT execution
                std::string script(payload.data(), payload_len);
                exit_code = execute_luajit(script, output);
            } else if (type == 2) {
                // Plugin execution
                std::string input(payload.data(), payload_len);
                size_t sep = input.find(':');
                if (sep == std::string::npos) {
                    output = "[ERROR] Plugin format: plugin_name:payload";
                    exit_code = -1;
                } else {
                    std::string plugin_name = input.substr(0, sep);
                    std::string plugin_data = input.substr(sep + 1);

                    std::lock_guard<std::mutex> lock(g_plugin_mutex);
                    auto it = g_plugins.find(plugin_name + ".so");
                    if (it != g_plugins.end()) {
                        char* raw_out = nullptr;
                        exit_code = it->second.execute(plugin_data.c_str(), &raw_out);
                        if (raw_out) {
                            output = raw_out;
                            free(raw_out);
                        }
                    } else {
                        output = "[ERROR] Plugin not found: " + plugin_name;
                        exit_code = -1;
                    }
                }
            }

            // Write response back
            uint32_t out_len = output.size();
            write(STDOUT_FILENO, &exit_code, sizeof(exit_code));
            write(STDOUT_FILENO, &out_len, sizeof(out_len));
            write(STDOUT_FILENO, output.data(), out_len);
            fsync(STDOUT_FILENO);
        }
        _exit(0);
    } else {
        // Parent
        close(stdin_fd[0]);
        close(stdout_fd[1]);
        g_workers[index] = {pid, {stdin_fd[1], -1}, {-1, stdout_fd[0]}};
        fprintf(stderr, "[POOL] Worker %d spawned (PID: %d)\n", index, pid);
    }
}

// ============================================================
// JOB DISPATCHER (runs in main thread)
// ============================================================
static void* dispatcher_thread(void*) {
    int next_worker = 0;

    while (g_running) {
        std::unique_lock<std::mutex> lock(g_queue_mutex);
        g_queue_cv.wait(lock, [] { return !g_job_queue.empty() || !g_running; });

        if (!g_running) break;

        JobRequest* job = g_job_queue.front();
        g_job_queue.pop();
        lock.unlock();

        // Round-robin dispatch
        WorkerProcess& worker = g_workers[next_worker];
        next_worker = (next_worker + 1) % g_worker_count;

        uint32_t type = job->type;
        uint32_t len = job->payload_len;
        write(worker.stdin_pipe[1], &type, sizeof(type));
        write(worker.stdin_pipe[1], &len, sizeof(len));
        write(worker.stdin_pipe[1], job->payload, len);

        g_active_jobs++;
        delete job; // job data copied to pipe, free memory
    }
    return nullptr;
}

// ============================================================
// RESPONSE COLLECTOR
// ============================================================
static void* response_thread(void*) {
    while (g_running) {
        for (int i = 0; i < g_worker_count; i++) {
            int fd = g_workers[i].stdout_pipe[0];
            if (fd <= 0) continue;

            fd_set rfds;
            FD_ZERO(&rfds);
            FD_SET(fd, &rfds);
            struct timeval tv{0, 10000}; // 10ms timeout

            if (select(fd + 1, &rfds, nullptr, nullptr, &tv) > 0) {
                int32_t exit_code;
                uint32_t out_len;
                if (read(fd, &exit_code, sizeof(exit_code)) <= 0) continue;
                if (read(fd, &out_len, sizeof(out_len)) <= 0) continue;

                std::vector<char> out_buf(out_len);
                if (read(fd, out_buf.data(), out_len) <= 0) continue;

                // Forward to stdout (will be captured by Node.js worker)
                std::string output(out_buf.data(), out_len);
                fprintf(stdout, "RESPONSE:%d:%s", exit_code, output.c_str());
                fflush(stdout);
                g_active_jobs--;
            }
        }
        usleep(1000);
    }
    return nullptr;
}

// ============================================================
// MAIN
// ============================================================
int main() {
    signal(SIGPIPE, SIG_IGN);

    // Load plugins
    load_plugins();

    // Spawn worker pool
    g_worker_count = std::min(MAX_WORKERS, (int)sysconf(_SC_NPROCESSORS_ONLN));
    for (int i = 0; i < g_worker_count; i++) {
        spawn_worker(i);
    }

    // Start dispatcher
    pthread_t dispatcher_tid, response_tid;
    pthread_create(&dispatcher_tid, nullptr, dispatcher_thread, nullptr);
    pthread_create(&response_tid, nullptr, response_thread, nullptr);

    // Main loop: read jobs from Node.js via UDS or stdin
    int server_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    unlink(SOCKET_PATH);
    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    strcpy(addr.sun_path, SOCKET_PATH);
    bind(server_fd, (struct sockaddr*)&addr, sizeof(addr));
    listen(server_fd, 256);

    fprintf(stderr, "[CORE] Listening on %s with %d workers\n", SOCKET_PATH, g_worker_count);

    while (g_running) {
        int client = accept(server_fd, nullptr, nullptr);
        if (client < 0) continue;

        // Read job from UDS
        uint64_t job_id;
        uint32_t type, payload_len;
        if (read(client, &job_id, sizeof(job_id)) <= 0) { close(client); continue; }
        if (read(client, &type, sizeof(type)) <= 0) { close(client); continue; }
        if (read(client, &payload_len, sizeof(payload_len)) <= 0) { close(client); continue; }

        JobRequest* job = (JobRequest*)malloc(sizeof(JobRequest) + payload_len);
        job->id = job_id;
        job->type = type;
        job->payload_len = payload_len;
        read(client, job->payload, payload_len);
        close(client);

        // Enqueue
        {
            std::lock_guard<std::mutex> lock(g_queue_mutex);
            g_job_queue.push(job);
        }
        g_queue_cv.notify_one();
    }

    close(server_fd);
    g_running = false;
    pthread_join(dispatcher_tid, nullptr);
    pthread_join(response_tid, nullptr);

    return 0;
}