#!/bin/bash
# Double-click (or run) to launch the widget on macOS/Linux.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
exec ./node_modules/.bin/electron . >/dev/null 2>&1
