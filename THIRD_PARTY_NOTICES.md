# Third-party notices and copyright statement

## Scope

This file describes the license boundary for the JaceCanvas open-source
source tree. It is not a replacement for the license shipped by any upstream
project. Before redistributing a binary, verify the exact version and retain
all upstream license and copyright files.

## Video2X local node

The `video2xLocal` node and its Electron bridge are JaceCanvas integration
code. They are covered by the JaceCanvas MIT License.

The Video2X executable and its runtime/model bundle are third-party materials:

- Project: [k4yt3x/video2x](https://github.com/k4yt3x/video2x)
- Source: Video2X Qt6 CLI/runtime and its upstream dependencies
- Notice: retain the upstream `LICENSE` and copyright notices when redistributing
- Status: open-source third-party component; not developed or owned by JaceCanvas

The node may use Real-ESRGAN, RealCUGAN and RIFE processors/models. Processor
code, model files and downloaded weights can have separate licenses. A model
license may impose restrictions different from the program license. Check the
license distributed with each exact file before commercial use or redistribution.

## Other bundled/runtime components

The desktop build may include or use the following projects. Their individual
licenses remain applicable:

- Electron and Chromium
- FFmpeg
- Qt 6
- NCNN / Vulkan runtime components
- Real-ESRGAN
- RealCUGAN
- RIFE
- React, Vite, Ant Design, XYFlow, Three.js, Zustand and other npm packages

Electron/Chromium notices are generated in the packaged application. FFmpeg
has its own notice under the runtime bundle. npm package licenses are listed
in their package directories and lockfile metadata.

## Media, icon and model assets

The startup animation, icons, sample media and 3D assets are not automatically
covered by the JaceCanvas MIT License. Do not redistribute an asset unless you
own it or have a license allowing redistribution. Replace these assets with
your own files for a public derivative if their rights are unclear.

## Copyright and acceptable use

JaceCanvas does not grant rights to third-party input media, generated results,
models, trademarks, faces, voices or datasets. Users are responsible for
copyright, trademark, portrait, privacy, publicity, export-control and other
legal requirements. Do not use the node to infringe rights or imply that a
third-party component is an original JaceCanvas model.

## Modification and canvas derivatives

Anyone may modify and further develop the JaceCanvas original canvas source,
node UI, director desk and adapters under the MIT License. Derivative canvas
projects may be private, public, personal, research or commercial, subject to
the MIT notice and all third-party notices above. Clearly mark substantial
changes and do not remove upstream notices.