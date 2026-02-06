{
  "targets": [
    {
      "target_name": "sgp4_native",
      "sources": [
        "sgp4_addon.c"
      ],
      "include_dirs": [
        "..",
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags": [
        "-O3",
        "-fPIC",
        "-Wall"
      ],
      "cflags!": [
        "-fno-exceptions"
      ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_OPTIMIZATION_LEVEL": "3",
            "OTHER_CFLAGS": [
              "-O3",
              "-march=native"
            ],
            "MACOSX_DEPLOYMENT_TARGET": "11.0"
          }
        }],
        ["OS=='linux'", {
          "cflags": [
            "-O3",
            "-march=native"
          ]
        }],
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "Optimization": "2"
            }
          }
        }]
      ]
    }
  ]
}
