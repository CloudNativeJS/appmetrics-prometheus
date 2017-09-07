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
    var cpuData = stringCPUData();
    var memoryData = stringMemoryData();
    var httpRequestTotal = stringHttpRequestTotal();
    var httpRequestDurationAverage = stringHttpRequestDurationAverage();
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.write(cpuData);
    res.write(memoryData);
    res.write(httpRequestTotal);
    res.write(httpRequestDurationAverage);
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
   * Functions to create Strings for the response
   */
  function stringCPUData() {
    var content = '';
    content += 'os_cpu_used_ratio ' + latestCPUEvent.system + '\n';
    content += 'process_cpu_used_ratio ' + latestCPUEvent.process + '\n';
    return content;
  }

  function stringMemoryData() {
    var content = '';
    content += 'os_resident_memory_bytes ' + latestMemEvent.physical_total + '\n';
    content += 'os_resident_memory_bytes_used ' + latestMemEvent.physical_used + '\n';
    content += 'os_resident_memory_bytes_free ' + latestMemEvent.physical_free + '\n';
    content += 'process_resident_memory_bytes ' + latestMemEvent.physical + '\n';
    content += 'process_virtual_memory_bytes ' + latestMemEvent.virtual + '\n';
    content += 'process_private_memory_bytes ' + latestMemEvent.private + '\n';
    return content;
  }

  function stringHttpRequestTotal() {
    var content = '';
    // Loop through httpURLDataList to display the appmetrics_http_requests_total
    for (var i = 0; i < httpURLDataList.length; i++) {
      var data = httpURLDataList[i];
      // Convert the method to lowercase as per Prometheus guidelines (Appmetrics gives us method in uppercase)
      var lowerCaseMethod = data.method.toLowerCase();
      content += 'http_requests_total{code="' + data.code + '", handler="' + data.url +
                 '", method="' + lowerCaseMethod + '"} ' + data.hits + '\n';
    }
    return content;
  }

  function stringHttpRequestDurationAverage() {
    var content = '';
    // Loop through httpURLDataList to display appmetrics_http_request_time_average
    for (var i = 0; i < httpURLDataList.length; i++) {
      var data = httpURLDataList[i];
      // Convert to microseconds as per Prometheus guidelines (Appmetrics gives us duration in milliseconds)
      var durationInMicroseconds = data.duration * 1000;
      // Convert the method to lowercase as per Prometheus guidelines (Appmetrics gives us method in uppercase)
      var lowerCaseMethod = data.method.toLowerCase();
      content += 'http_request_duration_microseconds_average{code="' + data.code + '", handler="' +
                 data.url + '", method="' + lowerCaseMethod + '"} ' + durationInMicroseconds + '\n';
    }
    return content;
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
  return server;
};
