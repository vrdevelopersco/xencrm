#!/bin/sh
# Compila el sidecar de Apple Foundation Models (requiere macOS 26+ y Command Line Tools: xcode-select --install)
set -e
cd "$(dirname "$0")"
mkdir -p bin
swiftc -O -parse-as-library main.swift -o bin/xencrm-afm
echo "ok -> sidecar/bin/xencrm-afm"
