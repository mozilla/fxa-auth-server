/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var cp = require('child_process')

var cmd = 'echo $PATH'
cp.exec(cmd, { env: { } }, function(err, stdout) {
  console.log('default $PATH:\n', stdout)
})

var cmd = 'git --help'
cp.exec(cmd, { env: { } }, function(err, stdout, stderr) {
  console.log('git --help:\n', err, stdout, stderr)
})
