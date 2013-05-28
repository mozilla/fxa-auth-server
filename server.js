/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Hapi = require('hapi');

const config = require('./lib/config');
const routes = require('./routes');

// server settings
var settings = {
  views: {
    path: 'templates',
    engines: {
      html: 'handlebars'
    }
  }
};

// Create a server with a host and port
var bind = config.get('bind_to');
var server = Hapi.createServer(bind.host, bind.port, settings);
server.addRoutes(routes);

server.ext(
  'onPreResponse',
  function (request, next) {
    var res = request.response();
    // error responses don't have `header`
    if (res.header) {
      res.header("Strict-Transport-Security", "max-age=10886400");
    }
    next();
  }
);

server.ext('onPreResponse', function (request, next) {
    var response = request.response();
    if (response.isBoom) {
      server.log(['error'],
        response.response.code + ' ' +
        response.response.payload.error + ': ' +
        response.message);
      server.log(['info'], 'request payload: ' + JSON.stringify(request.payload));
    }

    next();
});

server.pack.require('./node_modules/good', {
    subscribers: {
      console: ['ops', 'request', 'log']
    },
    extendedRequests: true,
    leakDetection: true
  },
  function(err) {
    if (err) server.log(['error'], err);
  });

//TODO throttle extension
//TODO toobusy extension

module.exports = server;

