# syntax=docker/dockerfile:1.4
# Dockerfile for building SGP4-WASM
# Uses Emscripten to compile NAIF CSPICE SGP4 to WebAssembly
# All building, compiling, testing, and running happens inside this container
# Note: Uses amd64 platform for Emscripten compatibility (runs via emulation on ARM Macs)
# Uses multi-stage builds for parallel execution with BuildKit

# =============================================================================
# Stage: base - Emscripten SDK setup
# =============================================================================
FROM --platform=linux/amd64 node:20-bookworm AS base

LABEL maintainer="sgp4-wasm"
LABEL description="Build environment for compiling NAIF CSPICE SGP4 to WebAssembly"

# Install Emscripten SDK
ENV EMSDK=/emsdk
RUN git clone https://github.com/emscripten-core/emsdk.git ${EMSDK} && \
    cd ${EMSDK} && \
    ./emsdk install 3.1.51 && \
    ./emsdk activate 3.1.51

ENV PATH="${EMSDK}:${EMSDK}/upstream/emscripten:${EMSDK}/node/22.16.0_64bit/bin:${PATH}"

# =============================================================================
# Stage: cspice - Download CSPICE toolkit (parallel with npm-deps)
# =============================================================================
FROM base AS cspice

WORKDIR /cspice-src

# Download and extract CSPICE toolkit
RUN echo "Downloading CSPICE toolkit..." && \
    curl -sL -o cspice.tar.Z https://naif.jpl.nasa.gov/pub/naif/toolkit/C/PC_Linux_GCC_64bit/packages/cspice.tar.Z && \
    tar -xzf cspice.tar.Z && \
    rm cspice.tar.Z

# Download leapseconds kernel
RUN mkdir -p /cspice-src/kernels && \
    curl -sL -o /cspice-src/kernels/naif0012.tls \
    https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls

# =============================================================================
# Stage: npm-deps - Install npm dependencies (parallel with cspice & wasm-build)
# =============================================================================
FROM --platform=linux/amd64 node:20-bookworm AS npm-deps

WORKDIR /app
COPY package*.json ./
RUN npm install

# =============================================================================
# Stage: wasm-build - Compile WASM (depends on cspice)
# =============================================================================
FROM cspice AS wasm-build

ENV CSPICE_DIR=/cspice-src/cspice
ENV KERNEL_FILE=/cspice-src/kernels/naif0012.tls

WORKDIR /wasm-build
COPY src/wrapper.c /wasm-build/wrapper.c

# Step 1: Compile all .c files to .o files in PARALLEL using xargs -P
RUN mkdir -p /wasm-build/obj && \
    echo "Compiling CSPICE source files in parallel..." && \
    find ${CSPICE_DIR}/src/cspice -name "*.c" | \
    xargs -P$(nproc) -I{} sh -c \
      'emcc -O3 -flto -c "$1" -o "/wasm-build/obj/$(basename "$1" .c).o" \
        -Wno-implicit-int -Wno-shift-op-parentheses -Wno-parentheses \
        -I${CSPICE_DIR}/include' _ {} && \
    emcc -O3 -flto -c wrapper.c -o /wasm-build/obj/wrapper.o \
      -Wno-implicit-int -Wno-shift-op-parentheses -Wno-parentheses \
      -I${CSPICE_DIR}/include && \
    echo "Compiled $(ls /wasm-build/obj/*.o | wc -l) object files"

# Step 2: Link all .o files into final WASM
RUN echo "Linking WASM..." && \
    emcc -O3 -flto \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORT_NAME="createSGP4Module" \
    -s INITIAL_MEMORY=67108864 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MAXIMUM_MEMORY=134217728 \
    -s STACK_SIZE=1048576 \
    -s FORCE_FILESYSTEM=1 \
    -s EXPORTED_FUNCTIONS='["_malloc","_free","_sgp4_init","_sgp4_parse_tle","_sgp4_propagate","_sgp4_propagate_minutes","_sgp4_utc_to_et","_sgp4_et_to_utc","_sgp4_get_last_error","_sgp4_clear_error","_sgp4_set_geophs","_sgp4_get_model","_sgp4_get_geophs"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","UTF8ToString","stringToUTF8","lengthBytesUTF8","FS"]' \
    -s ENVIRONMENT="web,node" \
    --embed-file ${KERNEL_FILE}@/kernels/naif0012.tls \
    -o sgp4.js \
    /wasm-build/obj/*.o && \
    echo "WASM compilation complete:" && \
    ls -lh /wasm-build/

# =============================================================================
# Stage: final - Combine all artifacts
# =============================================================================
FROM --platform=linux/amd64 node:20-bookworm AS final

WORKDIR /app

# Copy npm dependencies from parallel stage
COPY --from=npm-deps /app/node_modules ./node_modules
COPY package*.json ./

# Copy WASM artifacts from wasm-build stage
COPY --from=wasm-build /wasm-build/sgp4.js ./dist/
COPY --from=wasm-build /wasm-build/sgp4.wasm ./dist/

# Copy TypeScript source, tests, examples, data, and config
COPY tsconfig.json ./
COPY lib/ ./lib/
COPY tests/ ./tests/
COPY examples/ ./examples/
COPY data/ ./data/

# Compile TypeScript and copy assets
RUN npm run build && \
    echo "Build complete:" && \
    ls -lh dist/

# Default command
CMD ["npm", "start"]
