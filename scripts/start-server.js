#!/usr/bin/env node

var util = require('util')
var spawn = require('child_process').spawn

function log() {
  var args = Array.prototype.slice.call(arguments)
  process.stderr.write(util.format.apply(null, args.concat('\n')))
}

log('start-server starting %d', process.pid)

var notifier = 
  spawn('node', ['./bin/notifier.js'], 
        { stdio: ['pipe', 'pipe', 'ignore'] })
var authserver = 
  spawn('node', ['./bin/key_server.js'],
        { stdio: [ 'pipe', 'pipe', process.stderr ] })

authserver.stdout.pipe(notifier.stdin)

// propagate shutdown to the children
var signals = [ 'SIGINT', 'SIGTERM' ]
signals.forEach(function(signal) {
  process.on(signal, function() {
    log('received signal %s', signal);
    [ authserver, notifier ].forEach(function(proc) {
      var name = (proc === notifier) ? 'notifier' : 'authserver'
      log('sending signal %s to %s', signal, name)
      proc.kill(signal)
    })
  })
})

// propagate child exits to sibling
var authserverKilled
var events = [ 'error', 'close' ]
events.forEach(function(event) {
  authserver.on(event, function (arg) {
    log('authserver received event %s with: %s', event, arg)
    notifier.stdin.end() // will cause notifier to exit
  })
  notifier.on(event, function (arg) {
    log('notifier received event %s with: %s', event, arg)
    if (!authserverKilled) {
      authserverKilled = true
      authserver.kill('SIGTERM')
    }
  })
})
