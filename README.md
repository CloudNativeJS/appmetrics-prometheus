# appmetrics-prometheus

<!-- [![Build Status](https://travis-ci.org/RuntimeTools/appmetrics-dash.svg?branch=master)](https://travis-ci.org/RuntimeTools/appmetrics-dash)
[![codebeat badge](https://codebeat.co/badges/52b7334d-70b0-4659-9acb-b080d6413906)](https://codebeat.co/projects/github-com-runtimetools-appmetrics-dash-master)
[![codecov.io](https://codecov.io/github/RuntimeTools/appmetrics-dash/coverage.svg?branch=master)](https://codecov.io/github/RuntimeTools/appmetrics-dash?branch=master)
![Apache 2](https://img.shields.io/badge/license-Apache2-blue.svg?style=flat)
[![Homepage](https://img.shields.io/badge/homepage-Node%20Application%20Metrics-blue.svg)](https://developer.ibm.com/node/monitoring-post-mortem/application-metrics-node-js/) -->

<p align=center>
<a href='http://CloudNativeJS.io/'><img src='https://img.shields.io/badge/homepage-CloudNativeJS-blue.svg'></a>
<a href="https://travis-ci.org/RuntimeTools/appmetrics-dash.svg?branch=master"><img src="https://travis-ci.org/RuntimeTools/appmetrics-dash.svg?branch=master" alt="Build status"></a>
<a href='http://github.com/CloudNativeJS/ModuleLTS'><img src='https://img.shields.io/badge/Module%20LTS-Adopted-brightgreen.svg?style=flat' alt='Module LTS Adopted' /></a> 
<a href='http://ibm.biz/node-support'><img src='https://img.shields.io/badge/Support-IBM%20Frameworks-brightgreen.svg?style=flat' alt='IBM Support' /></a>   
</p>

appmetrics-prometheus provides a /metrics endpoint which is necessary for [Prometheus monitoring](https://prometheus.io/).

The data available on the /metrics endpoint is as follows:

* CPU
  * os_cpu_used_ratio (Ratio of systems CPU currently in use, type: gauge)
  * process_cpu_used_ratio (Ratio of process CPU currently in use, type: gauge)
* Memory
  * os_resident_memory_bytes (OS memory size in bytes, type: gauge)
  * process_resident_memory_bytes (Resident memory size in bytes, type: gauge)
  * process_virtual_memory_bytes (Virtual memory size in bytes, type: gauge)
* HTTP
  * http_requests_total (Total number of HTTP requests made, type: counter)
  * http_request_duration_microseconds (The HTTP request latencies in microseconds, type: summary)

appmetrics-prometheus uses [Node Application Metrics][1] to monitor the application.

## Configuring Prometheus

[Prometheus Documentation](https://prometheus.io/docs/introduction/overview/)

### Local Installation

Download Prometheus from: [Prometheus Downloads](https://prometheus.io/download/).

Follow the instructions on the [Prometheus getting started](https://prometheus.io/docs/introduction/getting_started/) page.

Or follow the simple example below.

Install Prometheus using:

```
tar xvfz prometheus-*.tar.gz
cd prometheus-*
```
Next you need to modify the configuration file that Prometheus uses.
In the prometheus folder there is a file named `prometheus.yml`.
In this file you can alter which IP addresses and port numbers are scraped by Prometheus and also how often the scraping occurs.

```
global:
  scrape_interval:     15s # By default, scrape targets every 15 seconds.
  # Attach these labels to any time series or alerts when communicating with
  # external systems (federation, remote storage, Alertmanager).
  external_labels:
    monitor: 'codelab-monitor'

# A scrape configuration:
scrape_configs:
  # The job name is added as a label `job=<job_name>` to any timeseries scraped from this config.
  - job_name: 'YOUR JOB NAME'

    # Override the global default and scrape targets from this job every 5 seconds.
    scrape_interval: 5s

    static_configs:
      - targets: ['IPADDRESS:PORT', 'IPADDRESS:PORT']
```

Set the targets field to your IP address and port number. You can monitor many applications by adding a comma between each IP address and port number.

Start Prometheus by using the command:

```
./prometheus -config.file=prometheus.yml
```
Prometheus can be found at `localhost:9090`.

<!-- ### Kubernetes

To use Prometheus with Kubernetes you can install it using [Helm](https://github.com/kubernetes/helm).

[Prometheus Chart](https://github.com/kubernetes/charts/tree/master/stable/prometheus)

`$ helm install stable/prometheus` -->

## Installation

```console
npm install appmetrics-prometheus
```

## Usage

Place the following code at the top of your applications server file.
```
require('appmetrics-prometheus').attach()
```

or to use preloading:
```sh
$ node --require appmetrics-prometheus/attach app.js
```

or to explicitly attach the express endpoint:
```
app.use('/metrics', require('appmetrics-prometheus').endpoint());
```

## prometheus = require('appmetrics-prometheus').attach()

This will launch the prometheus endpoint and start monitoring your application.
The prometheus metrics page is located at /metrics.

Simple example using the express framework.

```js
// This application uses express as its web server
// for more info, see: http://expressjs.com
var express = require('express');

var prometheus = require('appmetrics-prometheus').attach();

// cfenv provides access to your Cloud Foundry environment
// for more info, see: https://www.npmjs.com/package/cfenv
var cfenv = require('cfenv');

// create a new express server
var app = express();

// serve the files out of ./public as our main files
app.use(express.static(__dirname + '/public'));

// get the app environment from Cloud Foundry
var appEnv = cfenv.getAppEnv();

// start server on the specified port and binding host
var server = app.listen(appEnv.port, '0.0.0.0', function() {
	// print a message when the server starts listening
  console.log("server starting on " + appEnv.url);
});
```

## prometheus.attach(options)

* options.appmetrics {Object} An instance of `require('appmetrics')` can be
  injected if the application wants to use appmetrics, since it is a singleton
  module and only one can be present in an application. Optional, defaults to
  the appmetrics dependency of this module.

Auto-attach to all `http` servers created after this call, calling `prometheus.monitor(options)` for every server.

Simple example using attach.
```js
require('appmetrics-prometheus').attach();

var http = require('http');

const port = 3000;

const requestHandler = (request, response) => {  
  response.end('Hello')
}

const server = http.createServer(requestHandler);

server.listen(port, (err) => {  
  if (err) {
    return console.log('An error occurred', err)
  }
  console.log(`Server is listening on ${port}`)
});
```

## prometheus.endpoint(options)

Returns an endpoint that can be used as express middleware. Options are the same
as for `prometheus.attach(options)`.

```js
// This application uses express as its web server
// for more info, see: http://expressjs.com
var express = require('express');

// cfenv provides access to your Cloud Foundry environment
// for more info, see: https://www.npmjs.com/package/cfenv
var cfenv = require('cfenv');

// create a new express server
var app = express();

app.use('/metrics', require('appmetrics-prometheus').endpoint());

// serve the files out of ./public as our main files
app.use(express.static(__dirname + '/public'));

// get the app environment from Cloud Foundry
var appEnv = cfenv.getAppEnv();

// start server on the specified port and binding host
app.listen(appEnv.port, '0.0.0.0', function() {
  // print a message when the server starts listening
  console.log('server starting on ' + appEnv.url);
});
```


## Performance overhead

Our testing has shown that the performance overhead in terms of processing is minimal, adding less than 0.5 % to the CPU usage of your application.

We gathered this information by monitoring the sample application [Acme Air][3]. We used MongoDB as our datastore and used JMeter to drive load though the program.  We have performed this testing with Node.js version 6.10.3.

## Contributing

We welcome contributions. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details about the contributor licence agreement and other information. If you want to do anything more involved than a bug fix or a minor enhancement then we would recommend discussing it in an issue first before doing the work to make sure that it's likely to be accepted. We're also keen to improve test coverage and may not accept new code unless there are accompanying tests.


## Module Long Term Support Policy

This module adopts the [Module Long Term Support (LTS)](http://github.com/CloudNativeJS/ModuleLTS) policy, with the following End Of Life (EOL) dates:

| Module Version   | Release Date | Minimum EOL | EOL With     | Status  |
|------------------|--------------|-------------|--------------|---------|
| V2.x.x	         | Jun 2018     | Dec 2019    |              | Current |

## Version
3.1.0


## License

  [Apache-2.0](LICENSE)


[1]:https://developer.ibm.com/open/node-application-metrics/
[2]:https://www.npmjs.com/package/node-report/
[3]:https://github.com/acmeair/acmeair-nodejs/
