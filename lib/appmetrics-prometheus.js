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
var latestCPUEvent = {
  process: 0,
  system: 0
};
var latestMemEvent = {
  physical_used: 0,
  physical: 0,
  virtual: 0
};
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

    app.use(url, endpoint(options));
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

  return server;
};

exports.endpoint = endpoint;

function endpoint(options) {
  // appmetrics is a global singleton, allow the user's appmetrics to be
  // injected, only using our own if the user did not supply one.
  var appmetrics = (options || {}).appmetrics || require('appmetrics');
  var monitoring = appmetrics.monitor();
  function site(req, res) {
    var cpuData = stringCPUData(latestCPUEvent);
    var memoryData = stringMemoryData(latestMemEvent);
    var httpRequestTotal = stringHttpRequestTotal(httpURLDataList);
    var httpRequestDuration = stringHttpRequestDuration(httpURLDataList);
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.write(cpuData);
    res.write(memoryData);

    if (httpURLDataList.length > 0) {
      res.write(httpRequestTotal);
      res.write(httpRequestDuration);
    }
    res.end();
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
      urlData.average_duration = (urlData.duration * urlData.hits + data.duration) / (urlData.hits + 1);
      urlData.hits = urlData.hits + 1;
      // Add new duration to the duration_list
      urlData.duration_list.push(data.duration);
      // Reorder duration_list so it is in ascending order
      urlData.duration_list.sort(function(a, b){ return a - b; });
    } else {
      httpURLDataList.push({url: data.url, average_duration: data.duration, hits: 1, method: data.method, code: data.statusCode, duration_list: [data.duration]});
    }

  });
  return site;
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
function stringCPUData(latestCPUEvent) {
  var content = '';
  content += '# HELP os_cpu_used_ratio The ratio of the systems CPU that is currently used (values are 0-1)\n';
  content += '# TYPE os_cpu_used_ratio gauge\n';
  content += 'os_cpu_used_ratio ' + latestCPUEvent.system + '\n';
  content += '# HELP process_cpu_used_ratio The ratio of the process CPU that is currently used (values are 0-1)\n';
  content += '# TYPE process_cpu_used_ratio gauge\n';
  content += 'process_cpu_used_ratio ' + latestCPUEvent.process + '\n';
  return content;
}

function stringMemoryData(latestMemEvent) {
  var content = '';
  content += '# HELP os_resident_memory_bytes OS memory size in bytes.\n';
  content += '# TYPE os_resident_memory_bytes gauge\n';
  content += 'os_resident_memory_bytes ' + latestMemEvent.physical_used + '\n';
  content += '# HELP process_resident_memory_bytes Resident memory size in bytes.\n';
  content += '# TYPE process_resident_memory_bytes gauge\n';
  content += 'process_resident_memory_bytes ' + latestMemEvent.physical + '\n';
  content += '# HELP process_virtual_memory_bytes Virtual memory size in bytes.\n';
  content += '# TYPE process_virtual_memory_bytes gauge\n';
  content += 'process_virtual_memory_bytes ' + latestMemEvent.virtual + '\n';
  return content;
}

function stringHttpRequestTotal(httpURLDataList) {
  var content = '';
  content += '# HELP http_requests_total Total number of HTTP requests made.\n';
  content += '# TYPE http_requests_total counter\n';
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

function stringHttpRequestDuration(httpURLDataList) {
  var content = '';
  content += '# HELP http_request_duration_microseconds The HTTP request latencies in microseconds.\n';
  content += '# TYPE http_request_duration_microseconds summary\n';
  for (var i = 0; i < httpURLDataList.length; i++) {
    var data = httpURLDataList[i];
    var list = data.duration_list;
    var quantileFifty = findQuantile(list, 0.5);
    var quantileNinety = findQuantile(list, 0.9);
    var quantileNinetyNine = findQuantile(list, 0.99);
    var sumDurations = findSumOfArray(list);
    var countDurations = list.length;
    content += 'http_request_duration_microseconds{handler="' + data.url + '",quantile="0.5"} ' + quantileFifty + '\n';
    content += 'http_request_duration_microseconds{handler="' + data.url + '",quantile="0.9"} ' + quantileNinety + '\n';
    content += 'http_request_duration_microseconds{handler="' + data.url + '",quantile="0.99"} ' + quantileNinetyNine + '\n';
    content += 'http_request_duration_microseconds_sum{handler="' + data.url + '"} ' + sumDurations + '\n';
    content += 'http_request_duration_microseconds_count{handler="' + data.url + '"} ' + countDurations + '\n';
  }
  return content;
}

function findQuantile(list, quantile) {
  // Quantile must be a decimal, calculation: q(n+1)
  var n = list.length;
  var placeInList = Math.round((quantile * (n + 1)));
  var foundQuantile = '';
  // If the placeInList is greater than the size,
  // the foundQuantile must be the maximum index
  if (placeInList > n) {
    foundQuantile = list[n - 1];
  } else {
    // Locate the quantile in the list using index -1 due to the list starting at index 0
    foundQuantile = list[placeInList - 1];
  }
  return foundQuantile;
}

function findSumOfArray(arr) {
  var sum = 0;
  for (var i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}
