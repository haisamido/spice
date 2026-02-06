/**
 * Native SGP4 Batch Benchmark with SIMD
 *
 * Tests throughput of SIMD-accelerated batch propagation.
 * Compares against scalar implementation.
 *
 * Usage: ./benchmark_native_batch [satellites] [step] [workers]
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/mman.h>

#include "sgp4_batch.h"
#include "sgp4_simd.c"  // Include implementation directly for simplicity

// ISS TLE orbital elements (pre-parsed, in radians)
// From: 1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025
//       2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19
static const double ISS_INCLO  = 51.6400 * DEG2RAD;       // Inclination
static const double ISS_NODEO  = 208.9163 * DEG2RAD;      // RAAN
static const double ISS_ECCO   = 0.0006703;               // Eccentricity
static const double ISS_ARGPO  = 30.0825 * DEG2RAD;       // Arg of perigee
static const double ISS_MO     = 330.0579 * DEG2RAD;      // Mean anomaly
static const double ISS_NO     = 15.49560830 * TWOPI / MIN_PER_DAY;  // Mean motion (rad/min)
static const double ISS_BSTAR  = 0.00010270;              // Drag term
static const double ISS_NDOT   = 0.00016717 * TWOPI / (MIN_PER_DAY * MIN_PER_DAY);
static const double ISS_NDDOT  = 0.0;

// Get current time in seconds with nanosecond precision
static double get_time_sec(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

// Worker function for parallel batch processing
typedef struct {
    int start_sat;
    int end_sat;
    int steps;
    double step;
    long props;
} WorkerResult;

static void worker_process(
    int worker_id,
    int start_sat,
    int end_sat,
    int steps,
    double step,
    WorkerResult* result
) {
    int n_sats = end_sat - start_sat;
    if (n_sats <= 0) {
        result->props = 0;
        return;
    }

    // Allocate batch for this worker's satellites
    SGP4Batch* batch = sgp4_batch_alloc(n_sats);
    if (!batch) {
        fprintf(stderr, "Worker %d: Failed to allocate batch for %d satellites\n", worker_id, n_sats);
        result->props = -1;
        return;
    }

    // Initialize all satellites with ISS elements (simulating different sats)
    for (int i = 0; i < n_sats; i++) {
        // Add small variations to simulate different satellites
        double variation = (start_sat + i) * 0.0001;
        sgp4_batch_set(batch, i,
            ISS_NDOT, ISS_NDDOT, ISS_BSTAR,
            ISS_INCLO + variation,
            ISS_NODEO + variation,
            ISS_ECCO,
            ISS_ARGPO + variation,
            ISS_MO + variation,
            ISS_NO,
            0.0  // Epoch offset
        );
    }

    // Allocate result buffers (single step at a time to save memory)
    // Round up size for alignment
    size_t alloc_size = ((n_sats + 7) / 8) * 8 * sizeof(double);
    double* x  = aligned_alloc(64, alloc_size);
    double* y  = aligned_alloc(64, alloc_size);
    double* z  = aligned_alloc(64, alloc_size);
    double* vx = aligned_alloc(64, alloc_size);
    double* vy = aligned_alloc(64, alloc_size);
    double* vz = aligned_alloc(64, alloc_size);

    if (!x || !y || !z || !vx || !vy || !vz) {
        fprintf(stderr, "Worker %d: Failed to allocate result buffers\n", worker_id);
        sgp4_batch_free(batch);
        result->props = -1;
        return;
    }

    long props = 0;

    // Propagate each time step
    for (int t = 0; t < steps; t++) {
        double tsince = t * step / 60.0;  // seconds to minutes

        sgp4_batch_propagate_step(
            batch, tsince, &WGS72,
            x, y, z, vx, vy, vz
        );

        props += n_sats;
    }

    // Cleanup
    free(x); free(y); free(z);
    free(vx); free(vy); free(vz);
    sgp4_batch_free(batch);

    result->start_sat = start_sat;
    result->end_sat = end_sat;
    result->steps = steps;
    result->props = props;
}

int main(int argc, char* argv[]) {
    int satellites = 9534;
    int step = 60;
    int num_workers = 1;

    if (argc > 1) satellites = atoi(argv[1]);
    if (argc > 2) step = atoi(argv[2]);
    if (argc > 3) num_workers = atoi(argv[3]);

    // Clamp workers
    if (num_workers < 1) num_workers = 1;
    if (num_workers > 64) num_workers = 64;

    // Calculate time range (24 hours like other benchmarks)
    double duration = 86400.0;  // 24 hours in seconds
    int points_per_sat = (int)(duration / step) + 1;
    long total_props = (long)satellites * points_per_sat;

    printf("SGP4 Batch Benchmark (SIMD)\n");
    printf("===========================\n");
    printf("SIMD:          %s\n", sgp4_simd_name());
    printf("\nConfiguration:\n");
    printf("  Satellites:  %d\n", satellites);
    printf("  Step size:   %ds\n", step);
    printf("  Points/sat:  %d\n", points_per_sat);
    printf("  Total props: %ld\n", total_props);
    printf("  Workers:     %d\n", num_workers);
    printf("\nRunning benchmark...\n");

    // Allocate shared memory for results
    WorkerResult* results = mmap(NULL, num_workers * sizeof(WorkerResult),
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
            worker_process(i, start_sat, end_sat, points_per_sat, step, &results[i]);
            _exit(0);
        } else if (pid > 0) {
            pids[i] = pid;
        } else {
            perror("fork failed");
            return 1;
        }
    }

    // Wait for all workers
    for (int i = 0; i < num_workers; i++) {
        waitpid(pids[i], NULL, 0);
    }

    double end_time = get_time_sec();
    double wall_time = end_time - start_time;

    // Sum propagations
    long actual_props = 0;
    for (int i = 0; i < num_workers; i++) {
        if (results[i].props < 0) {
            printf("Worker %d failed\n", i);
        } else {
            actual_props += results[i].props;
        }
    }

    double props_per_sec = actual_props / wall_time;

    printf("\n=== Results ===\n");
    printf("  Wall time:    %.3fs\n", wall_time);
    printf("  Propagations: %ld\n", actual_props);
    printf("  Throughput:   %.0f prop/s\n", props_per_sec);
    printf("  Per sat:      %.3fms\n", (wall_time * 1000) / satellites);

    // Cleanup
    munmap(results, num_workers * sizeof(WorkerResult));
    free(pids);

    return 0;
}
