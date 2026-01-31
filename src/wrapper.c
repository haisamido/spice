/**
 * SGP4-WASM Wrapper
 *
 * C wrapper exposing NAIF CSPICE SGP4 functions for WebAssembly.
 * Provides a clean API for JavaScript to:
 * - Parse TLE (Two-Line Element) data
 * - Propagate satellite state vectors
 * - Convert between UTC and Ephemeris Time
 */

#include <stdio.h>
#include <string.h>
#include <emscripten.h>
#include "SpiceUsr.h"

/*
 * Geophysical Constants for SGP4
 * Index mapping (matches evsgp4_c expected order):
 *
 * Index  Parameter  Description
 * -----  ---------  ------------------------------------
 * 0      J2         J2 gravitational harmonic (dimensionless)
 * 1      J3         J3 gravitational harmonic (dimensionless)
 * 2      J4         J4 gravitational harmonic (dimensionless)
 * 3      KE         sqrt(GM) in earth-radii^(3/2) / minute
 * 4      QO         atmospheric model parameter (km)
 * 5      SO         atmospheric model parameter (km)
 * 6      RE         Earth equatorial radius (km)
 * 7      AE         distance units per Earth radius
 *
 * Default values are WGS-72 from Vallado's "Revisiting Spacetrack Report #3"
 */
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

/* Current geophysical model name */
static char current_model[32] = "wgs72";

/* Error message buffer */
static char last_error[1024] = {0};

/* Initialization flag */
static int initialized = 0;

/**
 * Initialize the SGP4 module by loading the leapseconds kernel.
 * Must be called before any other SGP4 functions.
 *
 * @return 0 on success, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int sgp4_init(void) {
    /* Reset any previous SPICE errors */
    reset_c();

    /* Set error action to return (don't abort) */
    erract_c("SET", 0, "RETURN");

    /* Load the embedded leapseconds kernel */
    furnsh_c("/kernels/naif0012.tls");

    if (failed_c()) {
        getmsg_c("LONG", 1024, last_error);
        reset_c();
        return -1;
    }

    initialized = 1;
    return 0;
}

/**
 * Set geophysical constants for SGP4 propagation.
 * Call this after sgp4_init() and before sgp4_propagate() to use
 * a different geophysical model (e.g., WGS-84 instead of WGS-72).
 *
 * @param j2   J2 gravitational harmonic (dimensionless)
 * @param j3   J3 gravitational harmonic (dimensionless)
 * @param j4   J4 gravitational harmonic (dimensionless)
 * @param ke   sqrt(GM) in earth-radii^(3/2) / minute
 * @param qo   Atmospheric model parameter (km)
 * @param so   Atmospheric model parameter (km)
 * @param re   Earth equatorial radius (km)
 * @param ae   Distance units per Earth radius
 * @param model_name  Name of the model (for logging, max 31 chars)
 */
EMSCRIPTEN_KEEPALIVE
void sgp4_set_geophs(
    double j2,
    double j3,
    double j4,
    double ke,
    double qo,
    double so,
    double re,
    double ae,
    const char* model_name
) {
    geophs[0] = j2;
    geophs[1] = j3;
    geophs[2] = j4;
    geophs[3] = ke;
    geophs[4] = qo;
    geophs[5] = so;
    geophs[6] = re;
    geophs[7] = ae;

    if (model_name != NULL) {
        strncpy(current_model, model_name, 31);
        current_model[31] = '\0';
    }
}

/**
 * Get the current geophysical model name.
 *
 * @return Model name string (e.g., "wgs72", "wgs84")
 */
EMSCRIPTEN_KEEPALIVE
const char* sgp4_get_model(void) {
    return current_model;
}

/**
 * Get the current geophysical constants.
 *
 * @param out_geophs  Output: 8-element array to receive constants
 */
EMSCRIPTEN_KEEPALIVE
void sgp4_get_geophs(double* out_geophs) {
    for (int i = 0; i < 8; i++) {
        out_geophs[i] = geophs[i];
    }
}

/**
 * Parse a Two-Line Element (TLE) set and extract orbital elements.
 *
 * @param line1  First line of TLE (69 characters)
 * @param line2  Second line of TLE (69 characters)
 * @param elems  Output: 10-element array of orbital elements
 *               [0] NDT20  - first derivative of mean motion / 2 (rad/min^2)
 *               [1] NDD60  - second derivative of mean motion / 6 (rad/min^3)
 *               [2] BSTAR  - B* drag coefficient
 *               [3] INCL   - inclination (radians)
 *               [4] NODE0  - right ascension of ascending node (radians)
 *               [5] ECC    - eccentricity
 *               [6] OMEGA  - argument of perigee (radians)
 *               [7] M0     - mean anomaly at epoch (radians)
 *               [8] N0     - mean motion (radians/minute)
 *               [9] EPOCH  - epoch time (seconds past J2000 TDB)
 *
 * @return Epoch as ephemeris time (ET, seconds past J2000), or -1e30 on error
 */
EMSCRIPTEN_KEEPALIVE
double sgp4_parse_tle(
    const char* line1,
    const char* line2,
    double* elems
) {
    SpiceDouble epoch;
    SpiceChar lines[2][70];

    if (!initialized) {
        strcpy(last_error, "SGP4 module not initialized. Call sgp4_init() first.");
        return -1.0e30;
    }

    /* Copy TLE lines - getelm_c expects fixed-width strings */
    memset(lines, ' ', sizeof(lines));
    strncpy(lines[0], line1, 69);
    strncpy(lines[1], line2, 69);
    lines[0][69] = '\0';
    lines[1][69] = '\0';

    /*
     * First year for two-digit year interpretation.
     * Years >= 57 are interpreted as 1957-1999
     * Years < 57 are interpreted as 2000-2056
     */
    SpiceInt frstyr = 1957;

    /* Parse the TLE */
    getelm_c(frstyr, 70, lines, &epoch, elems);

    if (failed_c()) {
        getmsg_c("LONG", 1024, last_error);
        reset_c();
        return -1.0e30;
    }

    return epoch;
}

/**
 * Propagate satellite state to a given ephemeris time.
 *
 * @param et     Ephemeris time (seconds past J2000 TDB)
 * @param elems  10-element orbital elements array from sgp4_parse_tle
 * @param state  Output: 6-element state vector in TEME frame
 *               [0-2] Position (x, y, z) in km
 *               [3-5] Velocity (vx, vy, vz) in km/s
 *
 * @return 0 on success, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int sgp4_propagate(
    double et,
    const double* elems,
    double* state
) {
    if (!initialized) {
        strcpy(last_error, "SGP4 module not initialized. Call sgp4_init() first.");
        return -1;
    }

    /* Propagate the state using SGP4 */
    evsgp4_c(et, geophs, elems, state);

    if (failed_c()) {
        getmsg_c("LONG", 1024, last_error);
        reset_c();
        return -1;
    }

    return 0;
}

/**
 * Propagate satellite state to a given number of minutes from TLE epoch.
 * This is a convenience function that calculates the target ET internally.
 *
 * @param tle_epoch  TLE epoch (ET from sgp4_parse_tle)
 * @param minutes    Minutes from TLE epoch (can be negative for past)
 * @param elems      10-element orbital elements array
 * @param state      Output: 6-element state vector in TEME frame
 *
 * @return 0 on success, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int sgp4_propagate_minutes(
    double tle_epoch,
    double minutes,
    const double* elems,
    double* state
) {
    double et = tle_epoch + (minutes * 60.0);
    return sgp4_propagate(et, elems, state);
}

/**
 * Convert a UTC time string to ephemeris time (ET).
 *
 * Accepts various time formats:
 * - ISO 8601: "2024-01-15T12:00:00"
 * - Calendar: "2024 Jan 15 12:00:00"
 * - Julian date: "JD 2460325.0"
 *
 * @param utc_string  UTC time string
 * @return Ephemeris time (seconds past J2000 TDB), or -1e30 on error
 */
EMSCRIPTEN_KEEPALIVE
double sgp4_utc_to_et(const char* utc_string) {
    SpiceDouble et;

    if (!initialized) {
        strcpy(last_error, "SGP4 module not initialized. Call sgp4_init() first.");
        return -1.0e30;
    }

    str2et_c(utc_string, &et);

    if (failed_c()) {
        getmsg_c("LONG", 1024, last_error);
        reset_c();
        return -1.0e30;
    }

    return et;
}

/**
 * Convert ephemeris time (ET) to a UTC string.
 *
 * @param et          Ephemeris time (seconds past J2000 TDB)
 * @param utc_string  Output buffer for UTC string
 * @param max_len     Maximum length of output buffer
 *
 * @return 0 on success, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int sgp4_et_to_utc(double et, char* utc_string, int max_len) {
    if (!initialized) {
        strcpy(last_error, "SGP4 module not initialized. Call sgp4_init() first.");
        return -1;
    }

    /* Format: ISOC = ISO Calendar format with 3 decimal places for seconds */
    et2utc_c(et, "ISOC", 3, max_len, utc_string);

    if (failed_c()) {
        getmsg_c("LONG", 1024, last_error);
        reset_c();
        return -1;
    }

    return 0;
}

/**
 * Get the last error message.
 *
 * @return Pointer to error message string (static buffer, do not free)
 */
EMSCRIPTEN_KEEPALIVE
const char* sgp4_get_last_error(void) {
    return last_error;
}

/**
 * Clear the error state.
 */
EMSCRIPTEN_KEEPALIVE
void sgp4_clear_error(void) {
    last_error[0] = '\0';
    reset_c();
}
