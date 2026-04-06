import { readFileSync } from 'node:fs'

export function createBanner(packageName, version) {
  return `/**
 * ${packageName} v${version}
 *
 * Copyright (c) Felix Orinda
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @license MIT
 */`
}

export function readPkg(dir) {
  return JSON.parse(readFileSync(`${dir}/package.json`, 'utf-8'))
}
