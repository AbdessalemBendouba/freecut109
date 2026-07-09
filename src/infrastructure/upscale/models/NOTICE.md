# Anime4K CNN 2x (M) — bundled model weights

These three ONNX graphs are the Anime4K `Upscale_CNN_x2_M` network. They are 12.7 KB each, so they
ship in the bundle rather than being downloaded at run time.

| file                       | trained for                              |
| -------------------------- | ---------------------------------------- |
| `anime4k_cnn_2x_m_an.onnx` | animation (the original Anime4K weights) |
| `anime4k_cnn_2x_m_rl.onnx` | live action                              |
| `anime4k_cnn_2x_m_3d.onnx` | 3D-rendered content                      |

`convert-weights.py` regenerates all three from WebSR's upstream JSON weights. It reproduces the
shader pipeline exactly, and its output is verified float32-exact against an independent NumPy
implementation of those shaders (`max|onnx - numpy| = 2.4e-07`).

## Attribution

Both upstream projects are MIT licensed, as is FreeCut. Their copyright notices are retained here.

### bloc97/Anime4K — https://github.com/bloc97/Anime4K

The original network architecture and the `an` weights.

> MIT License. Copyright (c) 2019 bloc97

### sb2702/websr — https://github.com/sb2702/websr

The WebGPU implementation, the JSON weight format this converter reads, and the retrained `rl` and
`3d` weights.

> MIT License. Copyright (c) 2023 Sam Bhattacharyya
