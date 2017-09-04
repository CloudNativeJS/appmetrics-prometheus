prometheusprometheus/*******************************************************************************
 * Copyright 2017 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 ******************************************************************************/

'use strict';

const debug = require('debug')('appmetrics-prometheus');
const util = require('util');

// Buffer 1 cpu, gc and memory event and aggregate other events
var latestCPUEvent = '';
var latestMemEvent = '';
var latestGCEvent = '';
var latestEventLoopEvent = '';
var aggregateHttpEvent = [];
var aggregateHttpOutboundEvent = [];
var aggregateProbeEvents = [];
// Used for top 5 response times
var httpURLData = {};

var save = {
  http: {},
  https: {},
};


exports.attach = function(options) {
  if (save.http.Server) {
    // Already attached.
    return exports;
  }
  // Protect our options from modification.
  options = util._extend({}, options);

  // if the user hasn't supplied appmetrics, require
  // here so we get http probe data
  if (!options.appmetrics) {
    options.appmetrics = require('appmetrics');
  }

  patch(save.http, require('http'));
  patch(save.https, require('https'));

  function patch(save, http) {
    // Patch the constructor as well as createServer.
    save.Server = http.Server;
    http.Server = function() {
      const server = save.Server.apply(this, arguments);
      options.server = server;
      exports.monitor(options);
      return server;
    };
    save.createServer = http.createServer;
    http.createServer = function() {
      const server = save.createServer.apply(this, arguments);
      options.server = server;
      exports.monitor(options);
      return server;
    };
  }

  return exports;
};

// Start monitoring process and subscribe to the data.
exports.monitor = function(options) {
  // Protect our options from modification.
  options = util._extend({}, options);
  var url = options.url || '/metrics';
  var title = options.title || 'Application Metrics for Node.js';
  var docs = options.docs || 'https://developer.ibm.com/node/application-metrics-node-js/';

  options.console = options.console || console;
  var log = options.console.log;
  var error = options.console.error;

  // appmetrics is a global singleton, allow the user's appmetrics to be
  // injected, only using our own if the user did not supply one.
  var appmetrics = options.appmetrics || require('appmetrics');
  // XXX(sam) We should let the user turn monitoring on or off! But we need
  // access to the monitor object to listen for events. Does monitor() actually
  // start appmetrics?
  var monitoring = appmetrics.monitor();
  var express = require('express');
  var server;

  if (!options.server) {
    // Create and use our own express server on the user-specified port/host.
    var port = options.port || 3001;  // Set a default port if one is not supplied
    var host = options.host;
    var app = express();
    server = require('http').Server(app);
    // XXX(sam) specify a path, to not collide with user's socket.io. Not
    // changing now, it will need coordination with FE javascript.
    app.use(url, site);
    server.listen(port, host, function() {
      var a = this.address();
      log('appmetrics-prometheus listening on %s:%s', a.address, a.port);
    });
  } else {
    // Use the server that has been defined by the application.
    server = options.server;
    // XXX(sam) specify a path, to not collide with user's socket.io. Not
    // changing now, it will need coordination with FE javascript.
    debug('patch existing request listeners');
    server.listeners('request').forEach(patch);


    debug('patch new request listeners...');
    server.on('newListener', function(eventName, listener) {
      if (eventName !== 'request') return;
      if (listener.__dashboard_patched) return;
      process.nextTick(function() { patch(listener); });
    });
  };

  function patch(listener) {
    debug('patching %s', listener);
    server.removeListener('request', listener);
    var app = express();

    app.use(url, site);
    app.use(url, siteNotFound);
    app.use(url, siteError);
    // If request not for the prometheus url, forward it back to the original
    // listener.
    app.use(function(req, res) {
      listener.call(server, req, res);
    });
    app.__dashboard_patched = true;
    server.on('request', app);
  }

  function site(req, res) {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.write('appmetrics_cpu_process: ' + latestCPUEvent.process + '\n');
    res.write('appmetrics_cpu_system: ' + latestCPUEvent.system + '\n');
    res.write('appmetrics_memory_physical_total: ' + latestMemEvent.physical_total + '\n');
    res.write('appmetrics_memory_physical_used: ' + latestMemEvent.physical_used + '\n');
    res.write('appmetrics_memory_physical_free: ' + latestMemEvent.physical_free + '\n');
    res.write('appmetrics_memory_virtual: ' + latestMemEvent.virtual + '\n');
    res.write('appmetrics_memory_private: ' + latestMemEvent.private + '\n');
    res.write('appmetrics_memory_physical: ' + latestMemEvent.physical + '\n');
    res.end();
  }

  function siteNotFound(req, res) {
    res.statusCode = 404;
    return res.end();
  }

  function siteError(err, req, res, _next) {
    res.statusCode = 500;
    return res.end(err.message);
  }

  /*
   * Broadcast monitoring data to connected clients when it arrives
   */
  monitoring.on('cpu', function(data) {
    latestCPUEvent = data;
  });

  monitoring.on('memory', function(data) {
    latestMemEvent = data;
  });

  monitoring.on('gc', function(data) {
    latestGCEvent = data;
  });

  monitoring.on('eventloop', function(data) {
    latestEventLoopEvent = data;
  });

  monitoring.on('http', function(data) {
    if (!aggregateHttpEvent) {
      aggregateHttpEvent = {};
      aggregateHttpEvent.total = 1;
      aggregateHttpEvent.average = data.duration;
      aggregateHttpEvent.longest = data.duration;
      aggregateHttpEvent.time = data.time;
      aggregateHttpEvent.url = data.url;
    } else {
      aggregateHttpEvent.total = aggregateHttpEvent.total + 1;
      aggregateHttpEvent.average = (aggregateHttpEvent.average * (aggregateHttpEvent.total - 1) + data.duration) / aggregateHttpEvent.total;
      if (data.duration > aggregateHttpEvent.longest) {
        aggregateHttpEvent.longest = data.duration;
        aggregateHttpEvent.url = data.url;
      }
    }

    if (httpURLData.hasOwnProperty(data.url)) {
      var urlData = httpURLData[data.url];
      // Recalculate the average
      urlData.duration = (urlData.duration * urlData.hits + data.duration) / (urlData.hits + 1);
      urlData.hits = urlData.hits + 1;
    } else {
      httpURLData[data.url] = {duration: data.duration, hits: 1};
    }
    // console.log(data);
    // console.log(aggregateHttpOutboundEvent);
    // console.log(urlData);
    console.log(httpURLData);
  });

  monitoring.on('http-outbound', function(data) {
    if (!aggregateHttpOutboundEvent) {
      aggregateHttpOutboundEvent = {};
      aggregateHttpOutboundEvent.total = 1;
      aggregateHttpOutboundEvent.average = data.duration;
      aggregateHttpOutboundEvent.longest = data.duration;
      aggregateHttpOutboundEvent.time = data.time;
      aggregateHttpOutboundEvent.url = data.url;
    } else {
      aggregateHttpOutboundEvent.total = aggregateHttpOutboundEvent.total + 1;
      aggregateHttpOutboundEvent.average = (aggregateHttpOutboundEvent.average * (aggregateHttpOutboundEvent.total - 1) + data.duration) / aggregateHttpOutboundEvent.total;
      if (data.duration > aggregateHttpOutboundEvent.longest) {
        aggregateHttpOutboundEvent.longest = data.duration;
        aggregateHttpOutboundEvent.url = data.url;
      }
    }
  });

  monitoring.on('mongo', function(data) {
    addProbeEvent('MongoDB', data);
  });

  monitoring.on('express', function(data) {
    addProbeEvent('Express', data);
  });

  monitoring.on('socketio', function(data) {
    addProbeEvent('Socket.IO', data);
  });

  monitoring.on('redis', function(data) {
    addProbeEvent('Redis', data);
  });

  monitoring.on('mysql', function(data) {
    addProbeEvent('MySQL', data);
  });

  monitoring.on('postgres', function(data) {
    addProbeEvent('Postgres', data);
  });

  monitoring.on('riak', function(data) {
    addProbeEvent('Riak', data);
  });

  monitoring.on('leveldown', function(data) {
    addProbeEvent('Leveldown', data);
  });
  return server;
};

function addProbeEvent(probename, data) {
  var found = false;
  for (var i = 0; i < aggregateProbeEvents.length; i++) {
    if (aggregateProbeEvents[i].name === probename) {
      found = true;
      var total = aggregateProbeEvents[i].total + 1;
      aggregateProbeEvents[i].total = total;
      aggregateProbeEvents[i].duration = (aggregateProbeEvents[i].duration * (total - 1) + data.duration) / total;
    }
  }
  if (!found) {
    aggregateProbeEvents.push({name: probename, total: 1, duration: data.duration, time: data.time});
  }
}
