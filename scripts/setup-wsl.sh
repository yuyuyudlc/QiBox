#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin

main() {
    local workspace=$1 isolation=/opt/isolation
    if (( EUID == 0 )); then
        fail 'Run setup as your regular Linux user.'
    fi

    check_directory "$isolation"
    check_directory "$workspace"
    local node_major
    node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
    local apt_packages=()
    if (( node_major < 24 )) || ! command -v npm >/dev/null; then
        if (( node_major < 24 )) && [[ -e /usr/local/bin/node || -L /usr/local/bin/node ]]; then
            fail 'Update your existing /usr/local/bin/node to Node.js 24 and rerun setup.'
        fi
        command -v curl >/dev/null || apt_packages+=(curl ca-certificates)
        command -v xz >/dev/null || apt_packages+=(xz-utils)
    fi
    command -v git >/dev/null || apt_packages+=(git)

    local npm_packages=()
    [[ -d "$isolation/node_modules/@anthropic-ai/claude-agent-sdk" ]] || npm_packages+=(@anthropic-ai/claude-agent-sdk@0.3.323)
    if [[ ! -d "$isolation/node_modules/node-pty" ]]; then
        npm_packages+=(node-pty@1.1.0)
        if ! command -v make >/dev/null || ! command -v g++ >/dev/null; then
            apt_packages+=(build-essential)
        fi
        command -v python3 >/dev/null || apt_packages+=(python3)
    fi
    if (( ${#apt_packages[@]} )); then
        sudo apt-get update
        sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${apt_packages[@]}"
    fi

    if (( node_major < 24 )) || ! command -v npm >/dev/null; then
        install_node
        if (( node_major < 24 )); then
            sudo ln -sT /usr/local/lib/qibox/node24/bin/node /usr/local/bin/node
        fi
        if ! command -v npm >/dev/null; then
            sudo ln -sT /usr/local/lib/qibox/node24/bin/npm /usr/local/bin/npm
        fi
        hash -r
    fi
    if ! command -v claude >/dev/null; then
        sudo env PATH="$PATH" npm install --global --prefix /usr/local @anthropic-ai/claude-code@latest
    fi
    local directory
    for directory in "$isolation" "$workspace"; do
        if [[ ! -d "$directory" ]]; then
            sudo install -d -o "$(id -u)" -g "$(id -g)" -- "$directory"
        fi
    done
    if (( ${#npm_packages[@]} )); then
        npm install --prefix "$isolation" --save-exact "${npm_packages[@]}"
    fi

    printf '\nWSL2 setup complete. In Qibox, open Settings > Runtime and start the environment.\n'
}

fail() {
    printf 'Setup failed: %s\n' "$1" >&2
    exit 1
}

check_directory() {
    if [[ -e "$1" ]] && [[ ! -d "$1" || ! -w "$1" || ! -x "$1" ]]; then
        fail "The current Linux user needs write access to $1."
    fi
}

install_node() (
    local prefix=/usr/local/lib/qibox/node24
    if [[ -x "$prefix/bin/node" && -x "$prefix/bin/npm" ]]; then
        return
    fi
    local arch
    case "$(uname -m)" in
        x86_64) arch=x64 ;;
        aarch64) arch=arm64 ;;
        *) fail 'Node.js setup supports x64 and ARM64 WSL2 distributions.' ;;
    esac

    local downloads=https://nodejs.org/dist/latest-v24.x
    local temp archive
    temp=$(mktemp -d)
    trap 'rm -rf -- "$temp"' EXIT
    cd "$temp"
    curl -fsSL --retry 2 "$downloads/SHASUMS256.txt" -o SHASUMS256.txt
    archive=$(awk -v suffix="-linux-$arch.tar.xz" '$2 ~ suffix "$" { print $2; exit }' SHASUMS256.txt)
    [[ -n "$archive" ]] || fail 'Could not find a Node.js 24 archive for this architecture.'
    curl -fsSL --retry 2 "$downloads/$archive" -o "$archive"
    sha256sum --check --ignore-missing SHASUMS256.txt
    sudo install -d -- "$prefix"
    sudo tar -xJf "$archive" -C "$prefix" --strip-components=1 --no-same-owner
)

wait_before_exit() {
    local status=$1
    if [[ -t 0 ]]; then
        printf '\nPress any key to return to Qibox...'
        IFS= read -rsn 1 || true
        printf '\n'
    fi
    exit "$status"
}

if [[ ${1:-} == --wait ]]; then
    shift
    trap 'wait_before_exit "$?"' EXIT
fi
main "${1:-/workspace}"
