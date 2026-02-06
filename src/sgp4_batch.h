/**
 * SGP4 Batch Processing with SIMD Support
 *
 * Structure-of-Arrays (SoA) layout for SIMD-friendly memory access.
 * Enables processing multiple satellites per CPU instruction.
 */

#ifndef SGP4_BATCH_H
#define SGP4_BATCH_H

#include <stdlib.h>
#include <string.h>
#include <math.h>

// Alignment for SIMD (64 bytes for AVX-512, works for NEON too)
#define SIMD_ALIGN 64

// WGS-72 geophysical constants
typedef struct {
    double j2;    // J2 gravitational harmonic
    double j3;    // J3 gravitational harmonic
    double j4;    // J4 gravitational harmonic
    double ke;    // sqrt(GM) in earth-radii^1.5/minute
    double qo;    // Atmospheric model parameter (km)
    double so;    // Atmospheric model parameter (km)
    double re;    // Earth equatorial radius (km)
    double ae;    // Distance units per Earth radius
} SGP4Geophs;

// Default WGS-72 constants
static const SGP4Geophs WGS72 = {
    .j2 = 1.082616e-3,
    .j3 = -2.53881e-6,
    .j4 = -1.65597e-6,
    .ke = 7.43669161e-2,
    .qo = 120.0,
    .so = 78.0,
    .re = 6378.135,
    .ae = 1.0
};

// Default WGS-84 constants
static const SGP4Geophs WGS84 = {
    .j2 = 1.08262998905e-3,
    .j3 = -2.53215306e-6,
    .j4 = -1.61098761e-6,
    .ke = 7.43669161331734132e-2,
    .qo = 120.0,
    .so = 78.0,
    .re = 6378.137,
    .ae = 1.0
};

/**
 * Batch TLE data in Structure-of-Arrays (SoA) layout.
 * Each array is aligned for SIMD access.
 *
 * Memory layout enables loading N satellite values with single SIMD instruction:
 *   inclo[0], inclo[1], inclo[2], inclo[3], ...  <- load 4/8 at once
 */
typedef struct {
    int count;           // Number of satellites
    int capacity;        // Allocated capacity (rounded up for SIMD)

    // Orbital elements (SoA layout, each array is [capacity] doubles)
    double* ndot;        // First derivative of mean motion
    double* nddot;       // Second derivative of mean motion
    double* bstar;       // Drag coefficient
    double* inclo;       // Inclination (radians)
    double* nodeo;       // Right ascension of ascending node (radians)
    double* ecco;        // Eccentricity
    double* argpo;       // Argument of perigee (radians)
    double* mo;          // Mean anomaly (radians)
    double* no;          // Mean motion (radians/minute)
    double* epoch;       // Epoch time (ET seconds)

    // Derived quantities (computed once during initialization)
    double* a;           // Semi-major axis
    double* alta;        // Apogee altitude
    double* altp;        // Perigee altitude
} SGP4Batch;

/**
 * Batch state vectors in SoA layout.
 */
typedef struct {
    int count;           // Number of satellites
    int steps;           // Number of time steps
    int capacity;        // Allocated satellite capacity

    // Position (km) - SoA layout [capacity * steps] each
    double* x;
    double* y;
    double* z;

    // Velocity (km/s) - SoA layout [capacity * steps] each
    double* vx;
    double* vy;
    double* vz;
} SGP4BatchResult;

/**
 * Allocate a batch structure with SIMD-aligned memory.
 * Capacity is rounded up to nearest multiple of 8 for AVX-512.
 */
static inline SGP4Batch* sgp4_batch_alloc(int count) {
    // Use malloc for struct (only arrays need SIMD alignment)
    SGP4Batch* batch = (SGP4Batch*)malloc(sizeof(SGP4Batch));
    if (!batch) return NULL;

    // Round up to multiple of 8 for SIMD
    int capacity = ((count + 7) / 8) * 8;

    batch->count = count;
    batch->capacity = capacity;

    // Allocate aligned arrays
    size_t size = capacity * sizeof(double);
    batch->ndot  = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->nddot = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->bstar = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->inclo = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->nodeo = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->ecco  = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->argpo = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->mo    = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->no    = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->epoch = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->a     = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->alta  = (double*)aligned_alloc(SIMD_ALIGN, size);
    batch->altp  = (double*)aligned_alloc(SIMD_ALIGN, size);

    // Zero padding for SIMD safety
    memset(batch->ndot,  0, size);
    memset(batch->nddot, 0, size);
    memset(batch->bstar, 0, size);
    memset(batch->inclo, 0, size);
    memset(batch->nodeo, 0, size);
    memset(batch->ecco,  0, size);
    memset(batch->argpo, 0, size);
    memset(batch->mo,    0, size);
    memset(batch->no,    0, size);
    memset(batch->epoch, 0, size);
    memset(batch->a,     0, size);
    memset(batch->alta,  0, size);
    memset(batch->altp,  0, size);

    return batch;
}

/**
 * Free batch memory.
 */
static inline void sgp4_batch_free(SGP4Batch* batch) {
    if (!batch) return;
    free(batch->ndot);
    free(batch->nddot);
    free(batch->bstar);
    free(batch->inclo);
    free(batch->nodeo);
    free(batch->ecco);
    free(batch->argpo);
    free(batch->mo);
    free(batch->no);
    free(batch->epoch);
    free(batch->a);
    free(batch->alta);
    free(batch->altp);
    free(batch);
}

/**
 * Allocate result structure.
 */
static inline SGP4BatchResult* sgp4_result_alloc(int count, int steps) {
    // Use malloc for struct (only arrays need SIMD alignment)
    SGP4BatchResult* result = (SGP4BatchResult*)malloc(sizeof(SGP4BatchResult));
    if (!result) return NULL;

    int capacity = ((count + 7) / 8) * 8;
    size_t size = (size_t)capacity * steps * sizeof(double);

    result->count = count;
    result->steps = steps;
    result->capacity = capacity;

    result->x  = (double*)aligned_alloc(SIMD_ALIGN, size);
    result->y  = (double*)aligned_alloc(SIMD_ALIGN, size);
    result->z  = (double*)aligned_alloc(SIMD_ALIGN, size);
    result->vx = (double*)aligned_alloc(SIMD_ALIGN, size);
    result->vy = (double*)aligned_alloc(SIMD_ALIGN, size);
    result->vz = (double*)aligned_alloc(SIMD_ALIGN, size);

    return result;
}

/**
 * Free result memory.
 */
static inline void sgp4_result_free(SGP4BatchResult* result) {
    if (!result) return;
    free(result->x);
    free(result->y);
    free(result->z);
    free(result->vx);
    free(result->vy);
    free(result->vz);
    free(result);
}

/**
 * Set orbital elements for one satellite in the batch.
 * Elements are in the same format as CSPICE getelm_c output.
 */
static inline void sgp4_batch_set(SGP4Batch* batch, int idx,
                                   double ndot, double nddot, double bstar,
                                   double inclo, double nodeo, double ecco,
                                   double argpo, double mo, double no,
                                   double epoch_et) {
    if (idx >= batch->capacity) return;

    batch->ndot[idx]  = ndot;
    batch->nddot[idx] = nddot;
    batch->bstar[idx] = bstar;
    batch->inclo[idx] = inclo;
    batch->nodeo[idx] = nodeo;
    batch->ecco[idx]  = ecco;
    batch->argpo[idx] = argpo;
    batch->mo[idx]    = mo;
    batch->no[idx]    = no;
    batch->epoch[idx] = epoch_et;
}

// Constants used in SGP4
#define PI 3.14159265358979323846
#define TWOPI (2.0 * PI)
#define DEG2RAD (PI / 180.0)
#define MIN_PER_DAY 1440.0
#define SEC_PER_MIN 60.0

#endif // SGP4_BATCH_H
