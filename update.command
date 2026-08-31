#!/usr/bin/env bash
# Effi Reactor Analysis — double-clickable updater for macOS.
# Thin wrapper so update.sh stays the single source of truth.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update.sh" "$@"
