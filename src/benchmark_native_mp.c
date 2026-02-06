/**
 * Native SGP4 Benchmark (Multi-Process) - Using fork() for parallelization
 *
 * CSPICE is NOT thread-safe due to global state. This version uses fork()
 * to create independent processes, each with its own CSPICE memory space.
 *
 * Build: cc -O3 -o benchmark_native_mp src/benchmark_native_mp.c -I.cspice/cspice/include .cspice/cspice/lib/cspice.a -lm
 * Usage: ./benchmark_native_mp [satellites] [step] [workers]
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/mman.h>
#include "SpiceUsr.h"

// WGS72 constants (same as WASM version)
static SpiceDouble geophs[8] = {
    1.082616e-3,     /* J2 gravitational harmonic */
   -2.53881e-6,      /* J3 gravitational harmonic */
   -1.65597e-6,      /* J4 gravitational harmonic */
    7.43669161e-2,   /* KE = sqrt(GM) in earth-radii^1.5/minute */
    120.0,           /* QO atmospheric model parameter (km) */
    78.0,            /* SO atmospheric model parameter (km) */
    6378.135,        /* RE Earth equatorial radius (km) */
    1.0              /* AE distance units per Earth radius */
};

// TLE for ISS (same as WASM benchmark)
static const char* TLE_LINE1 = "1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025";
static const char* TLE_LINE2 = "2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19";

// Get current time in seconds with nanosecond precision
static double get_time_sec(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

// Initialize CSPICE for a worker process
static int init_cspice(const char* kernel_path, SpiceDouble* elems) {
    // Set error handling to return (don't abort)
    erract_c("SET", 0, "RETURN");

    furnsh_c(kernel_path);
    if (failed_c()) {
        return -1;
    }

    // Parse TLE
    SpiceChar lines[2][70];
    memset(lines, ' ', sizeof(lines));
    strncpy(lines[0], TLE_LINE1, 69);
    strncpy(lines[1], TLE_LINE2, 69);
    lines[0][69] = '\0';
    lines[1][69] = '\0';

    SpiceDouble epoch;
    getelm_c(1957, 70, lines, &epoch, elems);
    if (failed_c()) {
        return -1;
    }

    return 0;
}

// Worker process: propagate a range of satellites
static void worker_process(int worker_id, int start_sat, int end_sat,
                           SpiceDouble et0, SpiceDouble etf, int step,
                           const char* kernel_path, long* result) {
    SpiceDouble elems[10];

    // Each forked process has its own CSPICE state
    if (init_cspice(kernel_path, elems) < 0) {
        *result = -1;
        return;
    }

    SpiceDouble state[6];
    long props = 0;

    for (int sat = start_sat; sat < end_sat; sat++) {
        for (SpiceDouble et = et0; et <= etf; et += step) {
            evsgp4_c(et, geophs, elems, state);
            props++;
        }
    }

    *result = props;
}

int main(int argc, char* argv[]) {
    int satellites = 9534;
    int step = 60;
    int num_workers = 4;

    if (argc > 1) satellites = atoi(argv[1]);
    if (argc > 2) step = atoi(argv[2]);
    if (argc > 3) num_workers = atoi(argv[3]);

    // Clamp workers to reasonable range
    if (num_workers < 1) num_workers = 1;
    if (num_workers > 64) num_workers = 64;

    // Build kernel path
    const char* kernels_dir = getenv("SPICE_KERNELS");
    char kernel_path[512];
    if (kernels_dir) {
        snprintf(kernel_path, sizeof(kernel_path), "%s/naif0012.tls", kernels_dir);
    } else {
        snprintf(kernel_path, sizeof(kernel_path), ".cspice/kernels/naif0012.tls");
    }

    // Initialize CSPICE in parent to compute time range
    erract_c("SET", 0, "RETURN");
    furnsh_c(kernel_path);
    if (failed_c()) {
        char errmsg[1024];
        getmsg_c("LONG", 1024, errmsg);
        printf("Error loading kernel: %s\n", errmsg);
        return 1;
    }

    SpiceDouble et0, etf;
    str2et_c("2024-01-15T12:00:00", &et0);
    etf = et0 + 86400.0;  // 24 hours

    int points_per_sat = (int)((etf - et0) / step) + 1;
    long total_props = (long)satellites * points_per_sat;

    printf("Initializing CSPICE...\n");
    printf("\nBenchmark Configuration:\n");
    printf("  Satellites:     %d\n", satellites);
    printf("  Step size:      %ds\n", step);
    printf("  Points/sat:     %d\n", points_per_sat);
    printf("  Total props:    %ld\n", total_props);
    printf("  Workers:        %d (processes)\n", num_workers);
    printf("\nRunning benchmark...\n");

    // Allocate shared memory for results (accessible by child processes)
    long* results = mmap(NULL, num_workers * sizeof(long),
                         PROT_READ | PROT_WRITE,
                         MAP_SHARED | MAP_ANONYMOUS, -1, 0);
    if (results == MAP_FAILED) {
        perror("mmap failed");
        return 1;
    }

    // Distribute satellites across workers
    int sats_per_worker = satellites / num_workers;
    int remainder = satellites % num_workers;

    pid_t* pids = malloc(num_workers * sizeof(pid_t));

    double start_time = get_time_sec();

    // Fork worker processes
    int current_sat = 0;
    for (int i = 0; i < num_workers; i++) {
        int start_sat = current_sat;
        int this_worker_sats = sats_per_worker + (i < remainder ? 1 : 0);
        int end_sat = current_sat + this_worker_sats;
        current_sat = end_sat;

        pid_t pid = fork();
        if (pid == 0) {
            // Child process
            worker_process(i, start_sat, end_sat, et0, etf, step,
                          kernel_path, &results[i]);
            _exit(0);
        } else if (pid > 0) {
            pids[i] = pid;
        } else {
            perror("fork failed");
            return 1;
        }
    }

    // Wait for all workers to complete
    for (int i = 0; i < num_workers; i++) {
        waitpid(pids[i], NULL, 0);
    }

    double end_time = get_time_sec();
    double wall_time = end_time - start_time;

    // Sum up propagations from all workers
    long actual_props = 0;
    for (int i = 0; i < num_workers; i++) {
        if (results[i] < 0) {
            printf("Worker %d failed\n", i);
        } else {
            actual_props += results[i];
        }
    }

    double props_per_sec = actual_props / wall_time;

    printf("\n=== Results ===\n");
    printf("  Wall time:      %.3fs\n", wall_time);
    printf("  Propagations:   %ld\n", actual_props);
    printf("  Throughput:     %.0f prop/s\n", props_per_sec);
    printf("  Per satellite:  %.3fms\n", (wall_time * 1000) / satellites);

    // Cleanup
    munmap(results, num_workers * sizeof(long));
    free(pids);

    return 0;
}
