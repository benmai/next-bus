require('dotenv').config();
var express = require('express');
var morgan = require('morgan');
var path = require('path');

var app = express();
var PORT = process.env.PORT || 3000;
var API_KEY = process.env.API_KEY;

// Access logging
app.use(morgan(':date[iso] :method :url :status :response-time ms'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API proxy endpoint
app.get('/api/arrivals', function(req, res) {
  var agency = req.query.agency;
  var stopCode = req.query.stopCode;

  if (!agency || !stopCode) {
    return res.status(400).json({ error: 'agency and stopCode are required' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'API_KEY not configured' });
  }

  var url = 'http://api.511.org/transit/StopMonitoring?api_key=' + API_KEY +
    '&agency=' + encodeURIComponent(agency) +
    '&stopCode=' + encodeURIComponent(stopCode) +
    '&format=json';

  fetch(url)
    .then(function(response) {
      if (!response.ok) {
        throw new Error('511 API returned ' + response.status);
      }
      return response.text();
    })
    .then(function(text) {
      // 511 API sometimes returns BOM character at start
      if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
      }
      var data = JSON.parse(text);
      res.json(data);
    })
    .catch(function(err) {
      console.error('API error:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// Get stops for an agency (cached to avoid rate limits)
var stopsCache = {};
var CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

app.get('/api/stops', function(req, res) {
  var agency = req.query.agency;

  if (!agency) {
    return res.status(400).json({ error: 'agency is required' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'API_KEY not configured' });
  }

  // Check cache
  var cached = stopsCache[agency];
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return res.json(cached.data);
  }

  var url = 'http://api.511.org/transit/stops?api_key=' + API_KEY +
    '&operator_id=' + encodeURIComponent(agency) +
    '&format=json';

  fetch(url)
    .then(function(response) {
      if (!response.ok) {
        throw new Error('511 API returned ' + response.status);
      }
      return response.text();
    })
    .then(function(text) {
      // 511 API sometimes returns BOM character at start
      if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
      }
      var data = JSON.parse(text);

      // Extract and simplify stops list
      var stops = [];
      if (data.Contents && data.Contents.dataObjects && data.Contents.dataObjects.ScheduledStopPoint) {
        var points = data.Contents.dataObjects.ScheduledStopPoint;
        for (var i = 0; i < points.length; i++) {
          var stop = points[i];
          stops.push({
            id: stop.id,
            name: stop.Name || stop.id
          });
        }
      }

      // Sort by name
      stops.sort(function(a, b) {
        return a.name.localeCompare(b.name);
      });

      // Cache the result
      stopsCache[agency] = {
        timestamp: Date.now(),
        data: stops
      };

      res.json(stops);
    })
    .catch(function(err) {
      console.error('Stops API error:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// Weather endpoint (using National Weather Service API - free, no key needed)
var weatherCache = {};
var WEATHER_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

app.get('/api/weather', function(req, res) {
  var lat = req.query.lat;
  var lon = req.query.lon;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  var cacheKey = lat + ',' + lon;
  var cached = weatherCache[cacheKey];
  if (cached && (Date.now() - cached.timestamp < WEATHER_CACHE_TTL)) {
    return res.json(cached.data);
  }

  // First get the grid point for this location
  var pointsUrl = 'https://api.weather.gov/points/' + lat + ',' + lon;

  fetch(pointsUrl, {
    headers: { 'User-Agent': 'NextBusDisplay/1.0' }
  })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('NWS points API returned ' + response.status);
      }
      return response.json();
    })
    .then(function(pointsData) {
      // Get the forecast URL from the points response
      var forecastUrl = pointsData.properties.forecastHourly;
      return fetch(forecastUrl, {
        headers: { 'User-Agent': 'NextBusDisplay/1.0' }
      });
    })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('NWS forecast API returned ' + response.status);
      }
      return response.json();
    })
    .then(function(forecastData) {
      // Get current period (first in the list)
      var current = forecastData.properties.periods[0];
      var weather = {
        temperature: current.temperature,
        unit: current.temperatureUnit,
        description: current.shortForecast,
        icon: current.icon
      };

      // Cache the result
      weatherCache[cacheKey] = {
        timestamp: Date.now(),
        data: weather
      };

      res.json(weather);
    })
    .catch(function(err) {
      console.error('Weather API error:', err.message);
      res.status(500).json({ error: err.message });
    });
});

// List of supported agencies
app.get('/api/agencies', function(req, res) {
  res.json([
    { id: 'AC', name: 'AC Transit' },
    { id: 'SF', name: 'SF Muni' },
    { id: 'BA', name: 'BART' },
    { id: 'CT', name: 'Caltrain' },
    { id: 'GG', name: 'Golden Gate Transit' },
    { id: 'SM', name: 'SamTrans' },
    { id: 'VTA', name: 'VTA' },
    { id: 'CC', name: 'County Connection' },
    { id: 'EM', name: 'Emery Go-Round' },
    { id: 'PE', name: 'Petaluma Transit' },
    { id: 'SR', name: 'Santa Rosa CityBus' },
    { id: 'WC', name: 'WestCAT' }
  ]);
});

app.listen(PORT, function() {
  console.log('Next Bus server running on http://localhost:' + PORT);
});
