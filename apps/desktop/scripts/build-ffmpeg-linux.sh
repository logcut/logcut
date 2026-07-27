#!/usr/bin/env bash
# Build the LGPL-only ffmpeg sidecar for Linux into vendor/ffmpeg/linux-<arch>/.
#
# Licensing invariants (identical to the macOS and Windows scripts):
#   - No --enable-gpl, no --enable-nonfree: the binary stays LGPL.
#   - Encoders are LGPL libmp3lame plus ffmpeg's own built-ins; no
#     libx264/libx265.
#   - All third-party libraries are compiled statically from the pinned
#     tarballs in ffmpeg-sources.env and listed in the generated SOURCES.md.
#
# No hardware acceleration, unlike the other two platforms. macOS gets
# VideoToolbox and Windows MediaFoundation for free because both are part of
# the OS; Linux's equivalent is VAAPI, which means linking libva and shipping a
# binary that only helps on Intel/AMD (NVIDIA would need the non-free NVENC).
# Everything LogCut asks ffmpeg for — probing, audio extraction, frames,
# waveforms — is a software path, so the dependency would buy nothing.
#
# Build on the OLDEST distribution you are willing to support: the binary is
# dynamically linked against glibc, and glibc is only forward compatible. CI
# uses ubuntu-22.04 for this reason.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=ffmpeg-sources.env
source "$ROOT/scripts/ffmpeg-sources.env"

ARCH="$(uname -m)"
# Node's process.arch spelling, which is what resolveBinary() looks for.
NODE_ARCH="$([ "$ARCH" = x86_64 ] && echo x64 || echo arm64)"
BUILD="$ROOT/.ffmpeg-build/linux-$NODE_ARCH"
DEPS="$BUILD/deps"
SRC="$BUILD/src"
OUT="$ROOT/vendor/ffmpeg/linux-$NODE_ARCH"
JOBS="$(nproc)"

# PKG_CONFIG_LIBDIR (not _PATH) restricts pkg-config to our static deps only.
# This matters far more here than on macOS: a distro build host has libva,
# libdrm, libxcb, SDL2 and friends installed, and ffmpeg's configure will
# happily link every one of them if it can see them.
export PKG_CONFIG_LIBDIR="$DEPS/lib/pkgconfig"

mkdir -p "$DEPS" "$SRC" "$OUT"

fetch() {
  # fetch <url> <tarball-name> <extracted-dir>: keeps downloaded tarballs,
  # but always re-extracts into a clean directory so stale build artifacts
  # from previous runs can never leak into the next configure.
  local url="$1" name="$2" dir="$3"
  if [ ! -f "$SRC/$name" ]; then
    echo "==> Downloading $name"
    curl -L --fail --retry 3 -o "$SRC/$name" "$url"
  fi
  rm -rf "${SRC:?}/$dir"
  tar -xf "$SRC/$name" -C "$SRC"
}

echo "==> freetype $FREETYPE_VERSION"
fetch "$FREETYPE_URL" "freetype-$FREETYPE_VERSION.tar.xz" "freetype-$FREETYPE_VERSION"
(
  cd "$SRC/freetype-$FREETYPE_VERSION"
  ./configure --prefix="$DEPS" --disable-shared --enable-static \
    --with-harfbuzz=no --with-brotli=no --with-png=no --with-bzip2=no --with-zlib=no > /dev/null
  make -j"$JOBS" > /dev/null
  make install > /dev/null
)

echo "==> fribidi $FRIBIDI_VERSION"
fetch "$FRIBIDI_URL" "fribidi-$FRIBIDI_VERSION.tar.xz" "fribidi-$FRIBIDI_VERSION"
(
  cd "$SRC/fribidi-$FRIBIDI_VERSION"
  ./configure --prefix="$DEPS" --disable-shared --enable-static --disable-docs > /dev/null
  make -j"$JOBS" > /dev/null
  make install > /dev/null
)

echo "==> harfbuzz $HARFBUZZ_VERSION"
fetch "$HARFBUZZ_URL" "harfbuzz-$HARFBUZZ_VERSION.tar.xz" "harfbuzz-$HARFBUZZ_VERSION"
(
  cd "$SRC/harfbuzz-$HARFBUZZ_VERSION"
  meson setup build --prefix="$DEPS" --default-library=static --buildtype=release \
    -Dfreetype=enabled -Dglib=disabled -Dgobject=disabled -Dcairo=disabled \
    -Dicu=disabled -Dtests=disabled -Ddocs=disabled -Dbenchmark=disabled \
    -Dintrospection=disabled > /dev/null
  ninja -C build > /dev/null
  ninja -C build install > /dev/null
)

echo "==> libass $LIBASS_VERSION"
fetch "$LIBASS_URL" "libass-$LIBASS_VERSION.tar.xz" "libass-$LIBASS_VERSION"
(
  cd "$SRC/libass-$LIBASS_VERSION"
  # fontconfig off to match the other platforms: nothing renders subtitles
  # through the sidecar yet, and it would be another runtime .so.
  ./configure --prefix="$DEPS" --disable-shared --enable-static \
    --disable-fontconfig > /dev/null
  make -j"$JOBS" > /dev/null
  make install > /dev/null
)

echo "==> lame $LAME_VERSION"
fetch "$LAME_URL" "lame-$LAME_VERSION.tar.gz" "lame-$LAME_VERSION"
(
  cd "$SRC/lame-$LAME_VERSION"
  ./configure --prefix="$DEPS" --disable-shared --enable-static \
    --disable-frontend > /dev/null
  make -j"$JOBS" > /dev/null
  make install > /dev/null
)

echo "==> ffmpeg $FFMPEG_VERSION"
fetch "$FFMPEG_URL" "ffmpeg-$FFMPEG_VERSION.tar.xz" "ffmpeg-$FFMPEG_VERSION"
(
  cd "$SRC/ffmpeg-$FFMPEG_VERSION"
  # The --disable-* list is longer than on the other platforms on purpose:
  # these are all things configure would otherwise pick up from a distro build
  # host and turn into runtime .so dependencies.
  ./configure --prefix="$BUILD/out" \
    --disable-gpl --disable-nonfree \
    --disable-shared --enable-static \
    --disable-doc --disable-debug --disable-ffplay --disable-sdl2 \
    --disable-vaapi --disable-vdpau --disable-libdrm \
    --disable-xlib --disable-libxcb --disable-alsa \
    --enable-libass --enable-libfreetype --enable-libharfbuzz --enable-libfribidi \
    --enable-libmp3lame \
    --pkg-config-flags=--static \
    --extra-cflags="-I$DEPS/include" --extra-ldflags="-L$DEPS/lib" > /dev/null
  make -j"$JOBS" > /dev/null
  make install > /dev/null
)

echo "==> Self checks (run before anything is copied to vendor/)"
FF="$BUILD/out/bin/ffmpeg"

echo "--- dynamic libraries (must be base system only)"
# Anything outside this list means configure found a distro library and linked
# it, which would make the sidecar refuse to start on a machine without it.
if ldd "$FF" | grep -vE '(linux-vdso|/ld-linux|libc\.so|libm\.so|libdl\.so|librt\.so|libpthread\.so|libgcc_s\.so|libstdc\+\+\.so|libz\.so|statically linked)'; then
  echo "FAIL: unexpected dynamic dependency found" >&2
  exit 1
fi

# Capture outputs first: piping ffmpeg straight into grep -q trips pipefail
# (grep exits on first match, ffmpeg dies with SIGPIPE).
VERSION_OUT="$("$FF" -version)"
ENCODERS_OUT="$("$FF" -hide_banner -encoders)"
FILTERS_OUT="$("$FF" -hide_banner -filters)"

echo "--- license flags"
grep -q -- '--disable-gpl' <<< "$VERSION_OUT" || { echo 'FAIL: --disable-gpl missing' >&2; exit 1; }
grep -q -- '--enable-gpl' <<< "$VERSION_OUT" && { echo 'FAIL: GPL enabled' >&2; exit 1; }

# No hardware encoder to assert here, unlike the other two platforms. These are
# the encoders the app actually drives: posters and filmstrips are mjpeg,
# waveforms are png, extracted audio is mp3.
echo "--- encoders"
grep -q libmp3lame <<< "$ENCODERS_OUT" || { echo 'FAIL: libmp3lame missing' >&2; exit 1; }
grep -qE '\bmjpeg\b' <<< "$ENCODERS_OUT" || { echo 'FAIL: mjpeg missing' >&2; exit 1; }
grep -qE '\bpng\b' <<< "$ENCODERS_OUT" || { echo 'FAIL: png missing' >&2; exit 1; }

echo "--- filters"
grep -q subtitles <<< "$FILTERS_OUT" || { echo 'FAIL: subtitles filter missing' >&2; exit 1; }
grep -q showwavespic <<< "$FILTERS_OUT" || { echo 'FAIL: showwavespic filter missing' >&2; exit 1; }

cp "$BUILD/out/bin/ffmpeg" "$BUILD/out/bin/ffprobe" "$OUT/"
cp "$SRC/ffmpeg-$FFMPEG_VERSION/COPYING.LGPLv2.1" "$OUT/"

{
  echo "# ffmpeg sidecar sources"
  echo
  echo "This binary is an LGPL-only ffmpeg build. Corresponding sources:"
  echo
  echo "- ffmpeg $FFMPEG_VERSION — $FFMPEG_URL"
  echo "- freetype $FREETYPE_VERSION — $FREETYPE_URL"
  echo "- fribidi $FRIBIDI_VERSION — $FRIBIDI_URL"
  echo "- harfbuzz $HARFBUZZ_VERSION — $HARFBUZZ_URL"
  echo "- libass $LIBASS_VERSION — $LIBASS_URL"
  echo "- lame $LAME_VERSION — $LAME_URL"
} > "$OUT/SOURCES.md"

echo "OK: $OUT"
