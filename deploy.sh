#!/usr/bin/env bash

yarn --cwd browser webpack
cd dist-prod
zip codewyng-chrome-extension.zip *
open .
