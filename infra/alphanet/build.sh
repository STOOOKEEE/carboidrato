#!/usr/bin/env bash
# Compile xrpld (branche `alphanet`, tous les amendments Supported::Yes) dans un conteneur Docker.
# À lancer sur hermes : bash infra/alphanet/build.sh
# Aucun port n'est publié : le conteneur de build ne fait que des téléchargements sortants.
set -euo pipefail

ALPHANET_DIR="${ALPHANET_DIR:-$HOME/dev/xrpl-alphanet}"
ALPHANET_COMMIT="e94e578"
BUILD_IMAGE="xrpl-alphanet-build"
BUILD_JOBS="${BUILD_JOBS:-4}"
BUILD_MEMORY="${BUILD_MEMORY:-12g}"
FEATURES_MACRO="include/xrpl/protocol/detail/features.macro"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$ALPHANET_DIR/home"
cd "$ALPHANET_DIR"
if [[ ! -d rippled ]]; then
    git clone --branch alphanet --single-branch https://github.com/XRPLF/rippled.git
fi
git -C rippled checkout --quiet "$ALPHANET_COMMIT"

# Même étape que la CI `force_supported` : tous les amendments deviennent Supported::Yes.
sed -i 's/Supported::No,/Supported::Yes,/g' "rippled/$FEATURES_MACRO"
if grep -q 'Supported::No,' "rippled/$FEATURES_MACRO"; then
    echo "Il reste des Supported::No dans $FEATURES_MACRO" >&2
    exit 1
fi

docker build --tag "$BUILD_IMAGE" --file "$SCRIPT_DIR/build.Dockerfile" "$SCRIPT_DIR"

docker run --rm --name xrpl-alphanet-build \
    --user "$(id -u):$(id -g)" \
    --cpus "$BUILD_JOBS" --memory "$BUILD_MEMORY" \
    --env HOME=/work/home --env CARGO_HOME=/work/home/.cargo \
    --volume "$ALPHANET_DIR:/work" \
    --workdir /work/rippled \
    "$BUILD_IMAGE" bash -euo pipefail -c "
        ./conan/init.sh
        mkdir -p build && cd build
        conan install .. --output-folder . --build missing \
            --settings build_type=Release --conf tools.build:jobs=$BUILD_JOBS
        cmake -G Ninja \
            -DCMAKE_TOOLCHAIN_FILE:FILEPATH=build/generators/conan_toolchain.cmake \
            -DCMAKE_BUILD_TYPE=Release -Dxrpld=ON -Dtests=OFF ..
        cmake --build . --parallel $BUILD_JOBS --target xrpld
    "

echo "Binaire : $ALPHANET_DIR/rippled/build/xrpld"
