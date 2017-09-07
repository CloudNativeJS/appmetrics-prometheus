/*******************************************************************************
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

// Buffer 1 cpu and memory event
var latestCPUEvent = '';
var latestMemEvent = '';
var aggregateHttpEvent;
var httpURLDataList = [];
var accumLoopTiming;
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
      monitor(options);
      return server;
    };
    save.createServer = http.createServer;
    http.createServer = function() {
      const server = save.createServer.apply(this, arguments);
      options.server = server;
      monitor(options);
      return server;
    };
  }
  return exports;
};

// Start monitoring process and subscribe to the data.
// Don't export monitor
var monitor = function(options) {
  // Protect our options from modification.
  options = util._extend({}, options);
  var url = '/metrics';

  options.console = options.console || console;

  // appmetrics is a global singleton, allow the user's appmetrics to be
  // injected, only using our own if the user did not supply one.
  var appmetrics = options.appmetrics || require('appmetrics');
  var monitoring = appmetrics.monitor();
  var express = require('express');
  var server;

  // Use the server that has been defined by the application.
  server = options.server;
  debug('patch existing request listeners');
  server.listeners('request').forEach(patch);
  debug('patch new request listeners...');
  server.on('newListener', function(eventName, listener) {
    if (eventName !== 'request') return;
    if (listener.__dashboard_patched) return;
    process.nextTick(function() { patch(listener); });
  });

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
    res.write('appmetrics_cpu_process ' + latestCPUEvent.process + '\n');
    res.write('appmetrics_cpu_system ' + latestCPUEvent.system + '\n');
    res.write('appmetrics_memory_physical_total ' + latestMemEvent.physical_total + '\n');
    res.write('appmetrics_memory_physical_used ' + latestMemEvent.physical_used + '\n');
    res.write('appmetrics_memory_physical_free ' + latestMemEvent.physical_free + '\n');
    res.write('appmetrics_memory_virtual ' + latestMemEvent.virtual + '\n');
    res.write('appmetrics_memory_private ' + latestMemEvent.private + '\n');
    res.write('appmetrics_memory_physical ' + latestMemEvent.physical + '\n');
    if (accumLoopTiming) {
      // XXX(sam) above will report 'undefined' as string value if data not
      // available, should I do the same here, or is not reporting the value
      // at all OK?
      res.write('appmetrics_loop_maximum ' + accumLoopTiming.maximum + '\n');
      res.write('appmetrics_loop_minimum ' + accumLoopTiming.minimum + '\n');
      res.write('appmetrics_loop_average ' + accumLoopTiming.average + '\n');
      res.write('appmetrics_loop_count ' + accumLoopTiming.count + '\n');
      accumLoopTiming = null;
    }
    // Loop through httpURLDataList to display appmetrics_http_request_time_average
    for (var i = 0; i < httpURLDataList.length; i++) {
      var data = httpURLDataList[i];
      res.write('appmetrics_http_request_time_average{handler="' + data.url + '", code="' + data.code + '", method="' + data.method + '"} ' + data.duration + '\n');
    }
    // Loop through httpURLDataList to display the appmetrics_http_requests_total
    for (i = 0; i < httpURLDataList.length; i++) {
      data = httpURLDataList[i];
      res.write('appmetrics_http_requests_total{handler="' + data.url + '", code="' + data.code + '", method="' + data.method + '"} ' + data.hits + '\n');
    }
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

  monitoring.on('http', function(data) {
    if (!aggregateHttpEvent) {
      aggregateHttpEvent = {};
      aggregateHttpEvent.total = 1;
      aggregateHttpEvent.average = data.duration;
      aggregateHttpEvent.longest = data.duration;
      aggregateHttpEvent.time = data.time;
      aggregateHttpEvent.handler = data.url;
      aggregateHttpEvent.code = data.statusCode;
      aggregateHttpEvent.method = data.method;
    } else {
      aggregateHttpEvent.total = aggregateHttpEvent.total + 1;
      aggregateHttpEvent.average = (aggregateHttpEvent.average * (aggregateHttpEvent.total - 1) + data.duration) / aggregateHttpEvent.total;
      if (data.duration > aggregateHttpEvent.longest) {
        aggregateHttpEvent.longest = data.duration;
        aggregateHttpEvent.url = data.url;
      }
    }

    // See if httpURLDataList contains a json object which has already has the collected url and statusCode
    var found = false;
    var foundIndex;
    var i = 0;
    while (found === false && i < httpURLDataList.length) {
      if (httpURLDataList[i].url == data.url && httpURLDataList[i].code == data.statusCode) {
        found = true;
        foundIndex = i;
      }
      i++;
    }

    // If found we increment the number of hits on the url
    // Else add new json object to list with the 'hits' value of 1
    if (found) {
      var urlData = httpURLDataList[foundIndex];
      // Recalculate the average
      urlData.duration = (urlData.duration * urlData.hits + data.duration) / (urlData.hits + 1);
      urlData.hits = urlData.hits + 1;
    } else {
      httpURLDataList.push({url: data.url, duration: data.duration, hits: 1, method: data.method, code: data.statusCode});
    }
  });

  // Accumulate stats until the next time the data is collected from the metrics
  // endpoint.
  monitoring.on('loop', function(data) {
    if (!accumLoopTiming) {
      accumLoopTiming = data;
      return;
    }
    accumLoopTiming.average = (
      accumLoopTiming.average * accumLoopTiming.count
      +
      data.average * data.count
    ) / (accumLoopTiming.count + data.count);

    accumLoopTiming.count += data.count;

    if (data.maximum > accumLoopTiming.maximum)
      accumLoopTiming.maximum = data.maximum;

    if (data.minimum < accumLoopTiming.minimum)
      accumLoopTiming.minimum = data.minimum;
  });

  return server;
};
