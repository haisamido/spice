/**
 * SGP4 Native Addon for Node.js
 *
 * N-API wrapper around SIMD-optimized SGP4 propagation.
 * Provides the same interface as the WASM module for comparison.
 */

#define NAPI_VERSION 8
#include <node_api.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <time.h>

// Include SIMD implementation
#include "../sgp4_batch.h"
#include "../sgp4_simd.c"

// Current geophysical model
static SGP4Geophs current_geophs;
static char current_model_name[64] = "wgs72";
static char last_error[512] = "";

// J2000 epoch: 2000-01-01T12:00:00.000 TDB
// In Unix timestamp (approximate, ignoring leap seconds for simplicity)
#define J2000_UNIX 946728000.0

// Helper: Set error message
static void set_error(const char* msg) {
    strncpy(last_error, msg, sizeof(last_error) - 1);
    last_error[sizeof(last_error) - 1] = '\0';
}

// Helper: Clear error
static void clear_error(void) {
    last_error[0] = '\0';
}

// Helper: Check N-API status
#define NAPI_CHECK(call) \
    do { \
        napi_status status = (call); \
        if (status != napi_ok) return NULL; \
    } while(0)

#define NAPI_CHECK_STATUS(env, call, msg) \
    do { \
        napi_status status = (call); \
        if (status != napi_ok) { \
            napi_throw_error(env, NULL, msg); \
            return NULL; \
        } \
    } while(0)

/**
 * Parse ISO 8601 UTC string to ephemeris time (seconds past J2000)
 * Supports: "2024-01-15T12:00:00" or "2024-01-15T12:00:00.000Z"
 */
static double utc_to_et(const char* utc) {
    int year, month, day, hour, min;
    double sec = 0.0;

    // Parse ISO 8601 format
    if (sscanf(utc, "%d-%d-%dT%d:%d:%lf", &year, &month, &day, &hour, &min, &sec) < 5) {
        // Try alternate format with space
        if (sscanf(utc, "%d-%d-%d %d:%d:%lf", &year, &month, &day, &hour, &min, &sec) < 5) {
            set_error("Invalid UTC format");
            return 0.0;
        }
    }

    // Convert to days since J2000
    // Using a simplified algorithm (ignoring leap seconds for speed)
    int a = (14 - month) / 12;
    int y = year + 4800 - a;
    int m = month + 12 * a - 3;

    // Julian Day Number
    int jdn = day + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045;

    // J2000 Julian Day: 2451545.0
    double jd = jdn + (hour - 12) / 24.0 + min / 1440.0 + sec / 86400.0;
    double days_since_j2000 = jd - 2451545.0;

    // Convert to seconds
    return days_since_j2000 * 86400.0;
}

/**
 * Convert ephemeris time to UTC ISO string
 */
static void et_to_utc(double et, char* buffer, size_t max_len) {
    // Convert ET (seconds past J2000) to Julian Day
    double jd = et / 86400.0 + 2451545.0;

    // Julian Day to calendar date (simplified algorithm)
    int z = (int)(jd + 0.5);
    double f = jd + 0.5 - z;

    int a = z;
    if (z >= 2299161) {
        int alpha = (int)((z - 1867216.25) / 36524.25);
        a = z + 1 + alpha - alpha / 4;
    }

    int b = a + 1524;
    int c = (int)((b - 122.1) / 365.25);
    int d = (int)(365.25 * c);
    int e = (int)((b - d) / 30.6001);

    int day = b - d - (int)(30.6001 * e);
    int month = (e < 14) ? e - 1 : e - 13;
    int year = (month > 2) ? c - 4716 : c - 4715;

    double day_frac = f * 24.0;
    int hour = (int)day_frac;
    double min_frac = (day_frac - hour) * 60.0;
    int min = (int)min_frac;
    double sec = (min_frac - min) * 60.0;

    snprintf(buffer, max_len, "%04d-%02d-%02dT%02d:%02d:%06.3fZ",
             year, month, day, hour, min, sec);
}

/**
 * Parse TLE into orbital elements
 * Returns 10-element array matching CSPICE getelm_c output format
 */
static int parse_tle(const char* line1, const char* line2, double* elements, double* epoch_et) {
    // Line 1 format (1-indexed columns):
    // 01    Line number (1)
    // 03-07 Satellite number
    // 08    Classification
    // 10-17 International designator
    // 19-32 Epoch (YYDDD.DDDDDDDD)
    // 34-43 First derivative of mean motion
    // 45-52 Second derivative of mean motion
    // 54-61 BSTAR drag term
    // 63    Ephemeris type
    // 65-68 Element set number
    // 69    Checksum

    // Line 2 format:
    // 01    Line number (2)
    // 03-07 Satellite number
    // 09-16 Inclination (degrees)
    // 18-25 RAAN (degrees)
    // 27-33 Eccentricity (decimal assumed)
    // 35-42 Argument of perigee (degrees)
    // 44-51 Mean anomaly (degrees)
    // 53-63 Mean motion (rev/day)
    // 64-68 Revolution number at epoch

    if (strlen(line1) < 68 || strlen(line2) < 68) {
        set_error("TLE lines too short");
        return -1;
    }

    // Parse epoch from line 1 (columns 19-32)
    char epoch_str[15];
    strncpy(epoch_str, line1 + 18, 14);
    epoch_str[14] = '\0';

    double epoch_val = atof(epoch_str);
    int epoch_year = (int)(epoch_val / 1000.0);
    double epoch_day = epoch_val - epoch_year * 1000.0;

    // Convert 2-digit year to 4-digit
    if (epoch_year < 57) {
        epoch_year += 2000;
    } else {
        epoch_year += 1900;
    }

    // Convert epoch to ET (seconds past J2000)
    // Days since J2000 for Jan 1 of epoch year
    int a = (14 - 1) / 12;
    int y = epoch_year + 4800 - a;
    int m = 1 + 12 * a - 3;
    int jdn_jan1 = 1 + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045;
    double jd_jan1 = jdn_jan1 - 0.5;  // JD at midnight
    double jd_epoch = jd_jan1 + epoch_day - 1.0;  // epoch_day is 1-indexed
    *epoch_et = (jd_epoch - 2451545.0) * 86400.0;

    // Parse mean motion derivative (columns 34-43)
    char ndot_str[12];
    strncpy(ndot_str, line1 + 33, 10);
    ndot_str[10] = '\0';
    double ndot = atof(ndot_str);

    // Parse second derivative (columns 45-52) - exponential notation
    char nddot_str[10];
    strncpy(nddot_str, line1 + 44, 8);
    nddot_str[8] = '\0';
    // Format: " NNNNN-E" where decimal is implied before first digit
    double nddot_mantissa = atof(nddot_str);
    int nddot_exp = 0;
    if (strlen(line1) > 51 && (line1[51] == '-' || line1[51] == '+')) {
        nddot_exp = atoi(line1 + 51);
    }
    double nddot = nddot_mantissa * pow(10.0, nddot_exp - 5);

    // Parse BSTAR (columns 54-61) - exponential notation
    char bstar_str[10];
    strncpy(bstar_str, line1 + 53, 8);
    bstar_str[8] = '\0';
    double bstar_mantissa = atof(bstar_str);
    int bstar_exp = 0;
    if (strlen(line1) > 60 && (line1[60] == '-' || line1[60] == '+')) {
        bstar_exp = atoi(line1 + 60);
    }
    double bstar = bstar_mantissa * pow(10.0, bstar_exp - 5);

    // Parse line 2
    char incl_str[10], raan_str[10], ecc_str[10], argp_str[10], ma_str[10], mm_str[13];

    strncpy(incl_str, line2 + 8, 8);  incl_str[8] = '\0';
    strncpy(raan_str, line2 + 17, 8); raan_str[8] = '\0';
    strncpy(ecc_str, line2 + 26, 7);  ecc_str[7] = '\0';
    strncpy(argp_str, line2 + 34, 8); argp_str[8] = '\0';
    strncpy(ma_str, line2 + 43, 8);   ma_str[8] = '\0';
    strncpy(mm_str, line2 + 52, 11);  mm_str[11] = '\0';

    double incl = atof(incl_str);      // degrees
    double raan = atof(raan_str);      // degrees
    double ecc = atof(ecc_str) / 1e7;  // implied decimal point
    double argp = atof(argp_str);      // degrees
    double ma = atof(ma_str);          // degrees
    double mm = atof(mm_str);          // rev/day

    // Convert to radians and CSPICE units
    double deg2rad = PI / 180.0;
    double rev_per_day_to_rad_per_min = TWOPI / MIN_PER_DAY;

    // Elements array format (matching CSPICE getelm_c):
    // [0] NDT20 - first derivative of mean motion / 2 (rad/min^2)
    // [1] NDD60 - second derivative of mean motion / 6 (rad/min^3)
    // [2] BSTAR - drag term (1/earth-radii)
    // [3] INCL  - inclination (radians)
    // [4] NODE0 - right ascension of ascending node (radians)
    // [5] ECC   - eccentricity
    // [6] OMEGA - argument of perigee (radians)
    // [7] M0    - mean anomaly (radians)
    // [8] N0    - mean motion (radians/minute)
    // [9] EPOCH - epoch (seconds past J2000)

    elements[0] = ndot * TWOPI / (MIN_PER_DAY * MIN_PER_DAY);  // NDT20
    elements[1] = nddot * TWOPI / (MIN_PER_DAY * MIN_PER_DAY * MIN_PER_DAY);  // NDD60
    elements[2] = bstar;
    elements[3] = incl * deg2rad;
    elements[4] = raan * deg2rad;
    elements[5] = ecc;
    elements[6] = argp * deg2rad;
    elements[7] = ma * deg2rad;
    elements[8] = mm * rev_per_day_to_rad_per_min;
    elements[9] = *epoch_et;

    return 0;
}

// ============================================================================
// N-API Functions
// ============================================================================

/**
 * init() - Initialize the module
 */
static napi_value NativeInit(napi_env env, napi_callback_info info) {
    // Initialize with WGS-72 constants (default)
    current_geophs = WGS72;
    strcpy(current_model_name, "wgs72");
    clear_error();

    napi_value result;
    napi_get_undefined(env, &result);
    return result;
}

/**
 * parseTLE(line1, line2) -> { epoch, elements: Float64Array }
 */
static napi_value NativeParseTLE(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    NAPI_CHECK_STATUS(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL),
                      "Failed to get arguments");

    if (argc < 2) {
        napi_throw_error(env, NULL, "parseTLE requires 2 arguments: line1, line2");
        return NULL;
    }

    // Get line1 string
    size_t line1_len;
    napi_get_value_string_utf8(env, argv[0], NULL, 0, &line1_len);
    char* line1 = malloc(line1_len + 1);
    napi_get_value_string_utf8(env, argv[0], line1, line1_len + 1, &line1_len);

    // Get line2 string
    size_t line2_len;
    napi_get_value_string_utf8(env, argv[1], NULL, 0, &line2_len);
    char* line2 = malloc(line2_len + 1);
    napi_get_value_string_utf8(env, argv[1], line2, line2_len + 1, &line2_len);

    // Parse TLE
    double elements[10];
    double epoch_et;
    int result = parse_tle(line1, line2, elements, &epoch_et);

    free(line1);
    free(line2);

    if (result < 0) {
        napi_throw_error(env, NULL, last_error);
        return NULL;
    }

    // Create result object { epoch, elements }
    napi_value obj;
    napi_create_object(env, &obj);

    // Set epoch
    napi_value epoch_val;
    napi_create_double(env, epoch_et, &epoch_val);
    napi_set_named_property(env, obj, "epoch", epoch_val);

    // Create Float64Array for elements
    napi_value array_buffer;
    void* data;
    napi_create_arraybuffer(env, 10 * sizeof(double), &data, &array_buffer);
    memcpy(data, elements, 10 * sizeof(double));

    napi_value typed_array;
    napi_create_typedarray(env, napi_float64_array, 10, array_buffer, 0, &typed_array);
    napi_set_named_property(env, obj, "elements", typed_array);

    return obj;
}

/**
 * propagate(elements: Float64Array, et: number) -> StateVector
 */
static napi_value NativePropagate(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    NAPI_CHECK_STATUS(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL),
                      "Failed to get arguments");

    if (argc < 2) {
        napi_throw_error(env, NULL, "propagate requires 2 arguments: elements, et");
        return NULL;
    }

    // Get elements array
    napi_typedarray_type type;
    size_t length;
    void* data;
    napi_value array_buffer;
    size_t offset;
    napi_get_typedarray_info(env, argv[0], &type, &length, &data, &array_buffer, &offset);

    if (type != napi_float64_array || length < 10) {
        napi_throw_error(env, NULL, "elements must be Float64Array with 10 elements");
        return NULL;
    }

    double* elements = (double*)data;

    // Get ET
    double et;
    napi_get_value_double(env, argv[1], &et);

    // Get epoch from elements[9]
    double epoch_et = elements[9];
    double tsince = (et - epoch_et) / 60.0;  // Convert to minutes

    // Create batch with single satellite
    SGP4Batch* batch = sgp4_batch_alloc(1);
    if (!batch) {
        napi_throw_error(env, NULL, "Failed to allocate batch");
        return NULL;
    }

    // Set elements
    sgp4_batch_set(batch, 0,
        elements[0],  // ndot
        elements[1],  // nddot
        elements[2],  // bstar
        elements[3],  // inclo
        elements[4],  // nodeo
        elements[5],  // ecco
        elements[6],  // argpo
        elements[7],  // mo
        elements[8],  // no
        epoch_et
    );

    // Allocate output
    double x[8], y[8], z[8], vx[8], vy[8], vz[8];

    // Propagate
    sgp4_batch_propagate_step(batch, tsince, &current_geophs, x, y, z, vx, vy, vz);

    sgp4_batch_free(batch);

    // Create result object
    napi_value result;
    napi_create_object(env, &result);

    // Position object
    napi_value position;
    napi_create_object(env, &position);
    napi_value px, py, pz;
    napi_create_double(env, x[0], &px);
    napi_create_double(env, y[0], &py);
    napi_create_double(env, z[0], &pz);
    napi_set_named_property(env, position, "x", px);
    napi_set_named_property(env, position, "y", py);
    napi_set_named_property(env, position, "z", pz);
    napi_set_named_property(env, result, "position", position);

    // Velocity object
    napi_value velocity;
    napi_create_object(env, &velocity);
    napi_value vvx, vvy, vvz;
    napi_create_double(env, vx[0], &vvx);
    napi_create_double(env, vy[0], &vvy);
    napi_create_double(env, vz[0], &vvz);
    napi_set_named_property(env, velocity, "vx", vvx);
    napi_set_named_property(env, velocity, "vy", vvy);
    napi_set_named_property(env, velocity, "vz", vvz);
    napi_set_named_property(env, result, "velocity", velocity);

    return result;
}

/**
 * propagateRange(elements: Float64Array, et0: number, etf: number, step: number)
 *   -> Array<{ et, position, velocity }>
 *
 * Batch propagation for time range - this is where SIMD shines
 */
static napi_value NativePropagateRange(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value argv[4];
    NAPI_CHECK_STATUS(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL),
                      "Failed to get arguments");

    if (argc < 4) {
        napi_throw_error(env, NULL, "propagateRange requires 4 arguments: elements, et0, etf, step");
        return NULL;
    }

    // Get elements array
    napi_typedarray_type type;
    size_t length;
    void* data;
    napi_value array_buffer;
    size_t offset;
    napi_get_typedarray_info(env, argv[0], &type, &length, &data, &array_buffer, &offset);

    if (type != napi_float64_array || length < 10) {
        napi_throw_error(env, NULL, "elements must be Float64Array with 10 elements");
        return NULL;
    }

    double* elements = (double*)data;

    // Get time parameters
    double et0, etf, step;
    napi_get_value_double(env, argv[1], &et0);
    napi_get_value_double(env, argv[2], &etf);
    napi_get_value_double(env, argv[3], &step);

    double epoch_et = elements[9];

    // Calculate number of steps
    int n_steps = (int)((etf - et0) / step) + 1;
    if (n_steps <= 0) n_steps = 1;

    // Create batch with single satellite (we propagate one sat over many times)
    SGP4Batch* batch = sgp4_batch_alloc(1);
    if (!batch) {
        napi_throw_error(env, NULL, "Failed to allocate batch");
        return NULL;
    }

    sgp4_batch_set(batch, 0,
        elements[0], elements[1], elements[2], elements[3], elements[4],
        elements[5], elements[6], elements[7], elements[8], epoch_et
    );

    // Allocate output arrays
    double x[8], y[8], z[8], vx[8], vy[8], vz[8];

    // Create result array
    napi_value result_array;
    napi_create_array_with_length(env, n_steps, &result_array);

    // Propagate each time step
    for (int i = 0; i < n_steps; i++) {
        double et = et0 + i * step;
        double tsince = (et - epoch_et) / 60.0;  // minutes

        sgp4_batch_propagate_step(batch, tsince, &current_geophs, x, y, z, vx, vy, vz);

        // Create state object
        napi_value state;
        napi_create_object(env, &state);

        // ET
        napi_value et_val;
        napi_create_double(env, et, &et_val);
        napi_set_named_property(env, state, "et", et_val);

        // Position
        napi_value position;
        napi_create_object(env, &position);
        napi_value px, py, pz;
        napi_create_double(env, x[0], &px);
        napi_create_double(env, y[0], &py);
        napi_create_double(env, z[0], &pz);
        napi_set_named_property(env, position, "x", px);
        napi_set_named_property(env, position, "y", py);
        napi_set_named_property(env, position, "z", pz);
        napi_set_named_property(env, state, "position", position);

        // Velocity
        napi_value velocity;
        napi_create_object(env, &velocity);
        napi_value vvx, vvy, vvz;
        napi_create_double(env, vx[0], &vvx);
        napi_create_double(env, vy[0], &vvy);
        napi_create_double(env, vz[0], &vvz);
        napi_set_named_property(env, velocity, "vx", vvx);
        napi_set_named_property(env, velocity, "vy", vvy);
        napi_set_named_property(env, velocity, "vz", vvz);
        napi_set_named_property(env, state, "velocity", velocity);

        napi_set_element(env, result_array, i, state);
    }

    sgp4_batch_free(batch);

    return result_array;
}

/**
 * utcToET(utc: string) -> number
 */
static napi_value NativeUtcToET(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    NAPI_CHECK_STATUS(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL),
                      "Failed to get arguments");

    if (argc < 1) {
        napi_throw_error(env, NULL, "utcToET requires 1 argument: utc string");
        return NULL;
    }

    size_t utc_len;
    napi_get_value_string_utf8(env, argv[0], NULL, 0, &utc_len);
    char* utc = malloc(utc_len + 1);
    napi_get_value_string_utf8(env, argv[0], utc, utc_len + 1, &utc_len);

    double et = utc_to_et(utc);
    free(utc);

    napi_value result;
    napi_create_double(env, et, &result);
    return result;
}

/**
 * etToUTC(et: number) -> string
 */
static napi_value NativeEtToUTC(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    NAPI_CHECK_STATUS(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL),
                      "Failed to get arguments");

    if (argc < 1) {
        napi_throw_error(env, NULL, "etToUTC requires 1 argument: et");
        return NULL;
    }

    double et;
    napi_get_value_double(env, argv[0], &et);

    char utc[64];
    et_to_utc(et, utc, sizeof(utc));

    napi_value result;
    napi_create_string_utf8(env, utc, NAPI_AUTO_LENGTH, &result);
    return result;
}

/**
 * setGeophysicalConstants(constants, modelName)
 */
static napi_value NativeSetGeophs(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    NAPI_CHECK_STATUS(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL),
                      "Failed to get arguments");

    if (argc < 1) {
        napi_throw_error(env, NULL, "setGeophysicalConstants requires constants object");
        return NULL;
    }

    // Get constants from object
    napi_value j2_val, j3_val, j4_val, ke_val, qo_val, so_val, re_val, ae_val;
    napi_get_named_property(env, argv[0], "J2", &j2_val);
    napi_get_named_property(env, argv[0], "J3", &j3_val);
    napi_get_named_property(env, argv[0], "J4", &j4_val);
    napi_get_named_property(env, argv[0], "KE", &ke_val);
    napi_get_named_property(env, argv[0], "QO", &qo_val);
    napi_get_named_property(env, argv[0], "SO", &so_val);
    napi_get_named_property(env, argv[0], "RE", &re_val);
    napi_get_named_property(env, argv[0], "AE", &ae_val);

    napi_get_value_double(env, j2_val, &current_geophs.j2);
    napi_get_value_double(env, j3_val, &current_geophs.j3);
    napi_get_value_double(env, j4_val, &current_geophs.j4);
    napi_get_value_double(env, ke_val, &current_geophs.ke);
    napi_get_value_double(env, qo_val, &current_geophs.qo);
    napi_get_value_double(env, so_val, &current_geophs.so);
    napi_get_value_double(env, re_val, &current_geophs.re);
    napi_get_value_double(env, ae_val, &current_geophs.ae);

    // Get model name if provided
    if (argc >= 2) {
        size_t name_len;
        napi_get_value_string_utf8(env, argv[1], NULL, 0, &name_len);
        if (name_len > 0 && name_len < sizeof(current_model_name)) {
            napi_get_value_string_utf8(env, argv[1], current_model_name,
                                       sizeof(current_model_name), &name_len);
        }
    }

    napi_value result;
    napi_get_undefined(env, &result);
    return result;
}

/**
 * getGeophysicalConstants() -> constants object
 */
static napi_value NativeGetGeophs(napi_env env, napi_callback_info info) {
    napi_value result;
    napi_create_object(env, &result);

    napi_value j2, j3, j4, ke, qo, so, re, ae;
    napi_create_double(env, current_geophs.j2, &j2);
    napi_create_double(env, current_geophs.j3, &j3);
    napi_create_double(env, current_geophs.j4, &j4);
    napi_create_double(env, current_geophs.ke, &ke);
    napi_create_double(env, current_geophs.qo, &qo);
    napi_create_double(env, current_geophs.so, &so);
    napi_create_double(env, current_geophs.re, &re);
    napi_create_double(env, current_geophs.ae, &ae);

    napi_set_named_property(env, result, "J2", j2);
    napi_set_named_property(env, result, "J3", j3);
    napi_set_named_property(env, result, "J4", j4);
    napi_set_named_property(env, result, "KE", ke);
    napi_set_named_property(env, result, "QO", qo);
    napi_set_named_property(env, result, "SO", so);
    napi_set_named_property(env, result, "RE", re);
    napi_set_named_property(env, result, "AE", ae);

    return result;
}

/**
 * getModelName() -> string
 */
static napi_value NativeGetModelName(napi_env env, napi_callback_info info) {
    napi_value result;
    napi_create_string_utf8(env, current_model_name, NAPI_AUTO_LENGTH, &result);
    return result;
}

/**
 * getLastError() -> string
 */
static napi_value NativeGetLastError(napi_env env, napi_callback_info info) {
    napi_value result;
    napi_create_string_utf8(env, last_error, NAPI_AUTO_LENGTH, &result);
    return result;
}

/**
 * clearError()
 */
static napi_value NativeClearError(napi_env env, napi_callback_info info) {
    clear_error();
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
}

/**
 * getSimdName() -> string (bonus: report which SIMD is in use)
 */
static napi_value NativeGetSimdName(napi_env env, napi_callback_info info) {
    napi_value result;
    napi_create_string_utf8(env, sgp4_simd_name(), NAPI_AUTO_LENGTH, &result);
    return result;
}

// ============================================================================
// Module Initialization
// ============================================================================

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor props[] = {
        { "init", NULL, NativeInit, NULL, NULL, NULL, napi_default, NULL },
        { "parseTLE", NULL, NativeParseTLE, NULL, NULL, NULL, napi_default, NULL },
        { "propagate", NULL, NativePropagate, NULL, NULL, NULL, napi_default, NULL },
        { "propagateRange", NULL, NativePropagateRange, NULL, NULL, NULL, napi_default, NULL },
        { "utcToET", NULL, NativeUtcToET, NULL, NULL, NULL, napi_default, NULL },
        { "etToUTC", NULL, NativeEtToUTC, NULL, NULL, NULL, napi_default, NULL },
        { "setGeophysicalConstants", NULL, NativeSetGeophs, NULL, NULL, NULL, napi_default, NULL },
        { "getGeophysicalConstants", NULL, NativeGetGeophs, NULL, NULL, NULL, napi_default, NULL },
        { "getModelName", NULL, NativeGetModelName, NULL, NULL, NULL, napi_default, NULL },
        { "getLastError", NULL, NativeGetLastError, NULL, NULL, NULL, napi_default, NULL },
        { "clearError", NULL, NativeClearError, NULL, NULL, NULL, napi_default, NULL },
        { "getSimdName", NULL, NativeGetSimdName, NULL, NULL, NULL, napi_default, NULL },
    };

    napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);

    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
