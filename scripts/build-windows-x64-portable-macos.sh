#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="x86_64-pc-windows-gnu"
MINGW_VERSION="14.0.0_3"
MINGW_CACHE_DIR="$ROOT_DIR/.cache/homebrew-cellar"
MINGW_PREFIX="$MINGW_CACHE_DIR/mingw-w64/$MINGW_VERSION"
MINGW_BIN="$MINGW_PREFIX/bin"
MINGW_X64="$MINGW_PREFIX/toolchain-x86_64"
MINGW_TARGET_LIB="$MINGW_X64/x86_64-w64-mingw32/lib"
MINGW_GCC_LIB="$MINGW_X64/lib/gcc/x86_64-w64-mingw32/16.2.0"
ARTIFACT_DIR="$ROOT_DIR/artifacts"
CARGO_TOML="$ROOT_DIR/src-tauri/Cargo.toml"
MAIN_RS="$ROOT_DIR/src-tauri/src/main.rs"
CARGO_TOML_BACKUP=""
MAIN_RS_BACKUP=""
CONSOLE_BUILD=0

log() {
  printf '[portable-win64] %s\n' "$*"
}

fail() {
  printf '[portable-win64] error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

find_bottle() {
  local formula="$1"
  find "$HOME/Library/Caches/Homebrew/downloads" "$HOME/Library/Caches/Homebrew" \
    -maxdepth 2 \
    -type f \
    \( -name "*--${formula}--*.bottle*.tar.gz" -o -name "${formula}--*.bottle*.tar.gz" \) \
    2>/dev/null \
    | head -n 1
}

extract_cached_bottle() {
  local formula="$1"
  local expected_dir="$2"

  if [[ -d "$expected_dir" ]]; then
    return
  fi

  local bottle
  bottle="$(find_bottle "$formula")"
  [[ -n "$bottle" ]] || fail "Homebrew bottle for $formula not found in cache; run: brew fetch $formula"

  log "extracting cached Homebrew bottle: $formula"
  mkdir -p "$MINGW_CACHE_DIR"
  tar -xzf "$bottle" -C "$MINGW_CACHE_DIR"
}

patch_install_name_if_macho() {
  local file="$1"
  shift

  if file "$file" | grep -q 'Mach-O'; then
    install_name_tool "$@" "$file" 2>/dev/null || true
  fi
}

patch_mingw_install_names() {
  local gmp="$MINGW_CACHE_DIR/gmp/6.3.0/lib/libgmp.10.dylib"
  local mpfr="$MINGW_CACHE_DIR/mpfr/4.2.2/lib/libmpfr.6.dylib"
  local libmpc="$MINGW_CACHE_DIR/libmpc/1.4.1/lib/libmpc.3.dylib"
  local isl="$MINGW_CACHE_DIR/isl/0.28/lib/libisl.23.dylib"

  [[ -f "$gmp" && -f "$mpfr" && -f "$libmpc" && -f "$isl" ]] || fail "cached MinGW dylib dependencies are incomplete"

  log "patching cached Homebrew bottle install names"
  patch_install_name_if_macho "$gmp" -id "$gmp"
  patch_install_name_if_macho "$mpfr" -id "$mpfr" -change '@@HOMEBREW_PREFIX@@/opt/gmp/lib/libgmp.10.dylib' "$gmp"
  patch_install_name_if_macho "$libmpc" -id "$libmpc" -change '@@HOMEBREW_PREFIX@@/opt/mpfr/lib/libmpfr.6.dylib' "$mpfr" -change '@@HOMEBREW_PREFIX@@/opt/gmp/lib/libgmp.10.dylib' "$gmp"
  patch_install_name_if_macho "$isl" -id "$isl" -change '@@HOMEBREW_PREFIX@@/opt/gmp/lib/libgmp.10.dylib' "$gmp"

  while IFS= read -r exe; do
    patch_install_name_if_macho "$exe" \
      -change '@@HOMEBREW_PREFIX@@/opt/zstd/lib/libzstd.1.dylib' '/usr/local/opt/zstd/lib/libzstd.1.dylib' \
      -change '@@HOMEBREW_PREFIX@@/opt/isl/lib/libisl.23.dylib' "$isl" \
      -change '@@HOMEBREW_PREFIX@@/opt/libmpc/lib/libmpc.3.dylib' "$libmpc" \
      -change '@@HOMEBREW_PREFIX@@/opt/mpfr/lib/libmpfr.6.dylib' "$mpfr" \
      -change '@@HOMEBREW_PREFIX@@/opt/gmp/lib/libgmp.10.dylib' "$gmp"
  done < <(find "$MINGW_PREFIX" -type f -perm +111 2>/dev/null)
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  need_cmd npm
  log "installing pnpm from npm"
  npm install -g pnpm@9.5.0
}

ensure_rust_target() {
  if ! command -v rustup >/dev/null 2>&1 && [[ -x "$HOME/.cargo/bin/rustup" ]]; then
    export PATH="$HOME/.cargo/bin:$PATH"
  fi

  need_cmd rustup
  need_cmd cargo

  if ! rustup target list --installed | grep -qx "$TARGET"; then
    log "installing Rust target: $TARGET"
    rustup target add "$TARGET"
  fi
}

ensure_mingw() {
  if command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
    MINGW_BIN="$(dirname "$(command -v x86_64-w64-mingw32-gcc)")"
    log "using installed MinGW: $MINGW_BIN"
    return
  fi

  if [[ -x "$MINGW_BIN/x86_64-w64-mingw32-gcc" ]]; then
    log "using cached MinGW: $MINGW_BIN"
    patch_mingw_install_names
    return
  fi

  if command -v brew >/dev/null 2>&1; then
    log "MinGW not found; trying Homebrew install"
    if brew install mingw-w64; then
      MINGW_BIN="$(dirname "$(command -v x86_64-w64-mingw32-gcc)")"
      return
    fi
  fi

  extract_cached_bottle mingw-w64 "$MINGW_PREFIX"
  extract_cached_bottle gmp "$MINGW_CACHE_DIR/gmp/6.3.0"
  extract_cached_bottle mpfr "$MINGW_CACHE_DIR/mpfr/4.2.2"
  extract_cached_bottle libmpc "$MINGW_CACHE_DIR/libmpc/1.4.1"
  extract_cached_bottle isl "$MINGW_CACHE_DIR/isl/0.28"
  patch_mingw_install_names

  [[ -x "$MINGW_BIN/x86_64-w64-mingw32-gcc" ]] || fail "MinGW linker was not prepared"
  PATH="$MINGW_BIN:$PATH" x86_64-w64-mingw32-gcc --version >/dev/null
}

restore_sources() {
  if [[ -n "$CARGO_TOML_BACKUP" && -f "$CARGO_TOML_BACKUP" ]]; then
    cp "$CARGO_TOML_BACKUP" "$CARGO_TOML"
    rm -f "$CARGO_TOML_BACKUP"
  fi
  if [[ -n "$MAIN_RS_BACKUP" && -f "$MAIN_RS_BACKUP" ]]; then
    cp "$MAIN_RS_BACKUP" "$MAIN_RS"
    rm -f "$MAIN_RS_BACKUP"
  fi
}

prepare_cargo_toml_for_desktop_cross_build() {
  if grep -q 'crate-type = \["staticlib", "cdylib", "rlib"\]' "$CARGO_TOML"; then
    CARGO_TOML_BACKUP="$(mktemp)"
    cp "$CARGO_TOML" "$CARGO_TOML_BACKUP"
    trap restore_sources EXIT
    log "temporarily limiting Rust lib crate-type to rlib for desktop exe cross-build"
    perl -0pi -e 's/crate-type = \["staticlib", "cdylib", "rlib"\]/crate-type = ["rlib"]/' "$CARGO_TOML"
  fi
}

prepare_main_rs_for_console_build() {
  if [[ "$CONSOLE_BUILD" != "1" ]]; then
    return
  fi

  if grep -q 'windows_subsystem = "windows"' "$MAIN_RS"; then
    MAIN_RS_BACKUP="$(mktemp)"
    cp "$MAIN_RS" "$MAIN_RS_BACKUP"
    trap restore_sources EXIT
    log "temporarily enabling Windows console output for diagnostics"
    perl -0pi -e 's/^#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]\n//' "$MAIN_RS"
  fi
}

build_portable() {
  local version
  version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
  local release_dir="$ROOT_DIR/src-tauri/target/$TARGET/release"
  local exe="$release_dir/copymanga-downloader.exe"
  local webview2="$release_dir/WebView2Loader.dll"
  local suffix="windows_x64_portable"
  if [[ "$CONSOLE_BUILD" == "1" ]]; then
    suffix="windows_x64_portable_console"
  fi
  local zip_path="$ARTIFACT_DIR/copymanga-downloader_${version}_${suffix}.zip"

  log "installing frontend dependencies"
  pnpm install

  prepare_cargo_toml_for_desktop_cross_build
  prepare_main_rs_for_console_build

  log "building Windows x64 exe"
  PATH="$MINGW_BIN:$HOME/.cargo/bin:$PATH" \
    CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=rust-lld \
    RUSTFLAGS="-C link-self-contained=yes -L native=$MINGW_TARGET_LIB -L native=$MINGW_GCC_LIB" \
    pnpm tauri build --target "$TARGET" --no-bundle

  [[ -f "$exe" ]] || fail "exe was not generated: $exe"
  [[ -f "$webview2" ]] || fail "WebView2Loader.dll was not generated: $webview2"

  mkdir -p "$ARTIFACT_DIR"
  rm -f "$zip_path"

  log "creating portable zip"
  (
    cd "$release_dir"
    zip -9 "$zip_path" copymanga-downloader.exe WebView2Loader.dll
  )

  zip -T "$zip_path"
  log "created: $zip_path"
  shasum -a 256 "$zip_path"
}

main() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "this script is for macOS"
  cd "$ROOT_DIR"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --console)
        CONSOLE_BUILD=1
        shift
        ;;
      -h|--help)
        printf 'Usage: %s [--console]\n' "$0"
        exit 0
        ;;
      *)
        fail "unknown argument: $1"
        ;;
    esac
  done

  need_cmd node
  need_cmd zip
  need_cmd shasum
  ensure_pnpm
  ensure_rust_target
  ensure_mingw
  build_portable
}

main "$@"
