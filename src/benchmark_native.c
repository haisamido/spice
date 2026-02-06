/**
 * Native SGP4 Benchmark - Compiled with native CSPICE
 *
 * Build: cc -O3 -o benchmark_native src/benchmark_native.c -I.cspice/cspice/include .cspice/cspice/lib/cspice.a -lm
 * Usage: ./benchmark_native [satellites] [step]
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
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

int main(int argc, char* argv[]) {
    int satellites = 9534;
    int step = 60;

    if (argc > 1) satellites = atoi(argv[1]);
    if (argc > 2) step = atoi(argv[2]);

    printf("Initializing CSPICE...\n");

    // Set error handling to return (don't abort)
    erract_c("SET", 0, "RETURN");

    // Load leapseconds kernel (use SPICE_KERNELS env var or default path)
    const char* kernels_dir = getenv("SPICE_KERNELS");
    char kernel_path[512];
    if (kernels_dir) {
        snprintf(kernel_path, sizeof(kernel_path), "%s/naif0012.tls", kernels_dir);
    } else {
        snprintf(kernel_path, sizeof(kernel_path), ".cspice/kernels/naif0012.tls");
    }
    furnsh_c(kernel_path);

    if (failed_c()) {
        char errmsg[1024];
        getmsg_c("LONG", 1024, errmsg);
        printf("Error loading kernel: %s\n", errmsg);
        return 1;
    }

    // Parse TLE using getelm_c (requires 2D char array)
    SpiceChar lines[2][70];
    memset(lines, ' ', sizeof(lines));
    strncpy(lines[0], TLE_LINE1, 69);
    strncpy(lines[1], TLE_LINE2, 69);
    lines[0][69] = '\0';
    lines[1][69] = '\0';

    SpiceDouble elems[10];
    SpiceDouble epoch;
    getelm_c(1957, 70, lines, &epoch, elems);

    if (failed_c()) {
        char errmsg[1024];
        getmsg_c("LONG", 1024, errmsg);
        printf("Error parsing TLE: %s\n", errmsg);
        return 1;
    }

    // Convert t0 to ET
    SpiceDouble et0;
    str2et_c("2024-01-15T12:00:00", &et0);
    SpiceDouble etf = et0 + 86400.0;  // 24 hours

    int points_per_sat = (int)((etf - et0) / step) + 1;
    long total_props = (long)satellites * points_per_sat;

    printf("\nBenchmark Configuration:\n");
    printf("  Satellites:     %d\n", satellites);
    printf("  Step size:      %ds\n", step);
    printf("  Points/sat:     %d\n", points_per_sat);
    printf("  Total props:    %ld\n", total_props);
    printf("\nRunning benchmark...\n");

    double start_time = get_time_sec();

    SpiceDouble state[6];

    // Simulate N satellites, each propagated for 24 hours
    for (int sat = 0; sat < satellites; sat++) {
        for (SpiceDouble et = et0; et <= etf; et += step) {
            // Propagate using evsgp4_c (CSPICE SGP4 function)
            evsgp4_c(et, geophs, elems, state);
        }
    }

    double end_time = get_time_sec();
    double wall_time = end_time - start_time;
    double props_per_sec = total_props / wall_time;

    printf("\n=== Results ===\n");
    printf("  Wall time:      %.3fs\n", wall_time);
    printf("  Propagations:   %ld\n", total_props);
    printf("  Throughput:     %.0f prop/s\n", props_per_sec);
    printf("  Per satellite:  %.3fms\n", (wall_time * 1000) / satellites);

    return 0;
}
