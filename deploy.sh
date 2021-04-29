#!/usr/bin/env bash

set -e

cd "$(dirname "${BASH_SOURCE[0]}")"

yarn --cwd browser webpack
cd dist-prod
zip codewing-chrome-extension.zip *
open .
