(function() {
  'use strict';

  var REFRESH_INTERVAL = 60000; // 60 seconds
  var MAX_ARRIVALS = 2;

  // Server-provided defaults (loaded on init)
  var serverConfig = { stops: [], location: null };

  var GREETINGS = [
    'Have a great day!',
    'You\'re doing great!',
    'Make today amazing!',
    'You\'ve got this!',
    'Today is full of possibilities!',
    'Be kind to yourself today.',
    'Good things are coming your way!',
    'You make the world brighter!',
    'Believe in yourself!',
    'Every day is a fresh start.',
    'You are appreciated!',
    'Keep being awesome!',
    'Smile, you\'re wonderful!',
    'Today is going to be a good day!',
    'You bring joy to others!',
    'Take a deep breath. You\'ve got this.',
    'The best is yet to come!',
    'You are stronger than you think!',
    'Wishing you a beautiful day!',
    'Remember to take breaks!'
  ];

  // Show a random greeting (changes once per page load)
  function showGreeting() {
    var greetingEl = document.getElementById('greeting');
    if (greetingEl) {
      var index = Math.floor(Math.random() * GREETINGS.length);
      greetingEl.textContent = GREETINGS[index];
    }
  }

  // Get stops from localStorage, falling back to server config
  function getStops() {
    try {
      var stored = localStorage.getItem('nextbus_stops');
      if (stored) {
        var parsed = JSON.parse(stored);
        if (parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return serverConfig.stops || [];
  }

  // Get location from localStorage, falling back to server config
  function getLocation() {
    try {
      var stored = localStorage.getItem('nextbus_location');
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return serverConfig.location || null;
  }

  // Fetch server config (defaults from .env)
  function fetchConfig(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/config', true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            serverConfig = JSON.parse(xhr.responseText);
          } catch (e) {}
        }
        callback();
      }
    };
    xhr.send();
  }

  // Fetch and display weather
  function refreshWeather() {
    var location = getLocation();
    var weatherEl = document.getElementById('weather');

    if (!location || !weatherEl) {
      if (weatherEl) weatherEl.innerHTML = '';
      return;
    }

    var url = '/api/weather?lat=' + encodeURIComponent(location.lat) +
              '&lon=' + encodeURIComponent(location.lon);

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            var data = JSON.parse(xhr.responseText);
            weatherEl.innerHTML = '<span class="weather-temp">' + data.temperature + '°' + data.unit + '</span> ' +
                                  '<span class="weather-desc">' + escapeHtml(data.description) + '</span>';
          } catch (e) {
            weatherEl.innerHTML = '';
          }
        } else {
          weatherEl.innerHTML = '';
        }
      }
    };
    xhr.send();
  }

  // Fetch arrivals for a single stop
  function fetchArrivals(stop, callback) {
    var url = '/api/arrivals?agency=' + encodeURIComponent(stop.agency) +
              '&stopCode=' + encodeURIComponent(stop.stopCode);

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            var data = JSON.parse(xhr.responseText);
            callback(null, data);
          } catch (e) {
            callback(e, null);
          }
        } else {
          callback(new Error('HTTP ' + xhr.status), null);
        }
      }
    };
    xhr.send();
  }

  // Parse arrival time and return minutes from now
  function getMinutesUntil(expectedTime) {
    if (!expectedTime) return null;
    var arrival = new Date(expectedTime);
    var now = new Date();
    var diffMs = arrival - now;
    var diffMins = Math.round(diffMs / 60000);
    return diffMins < 0 ? 0 : diffMins;
  }

  // Extract arrivals from 511 API response
  function parseArrivals(data) {
    var arrivals = [];
    try {
      var delivery = data.ServiceDelivery;
      var monitoring = delivery.StopMonitoringDelivery;
      var visits = monitoring.MonitoredStopVisit || [];

      for (var i = 0; i < visits.length && arrivals.length < MAX_ARRIVALS; i++) {
        var journey = visits[i].MonitoredVehicleJourney;
        var call = journey.MonitoredCall;

        var expectedTime = call.ExpectedArrivalTime || call.ExpectedDepartureTime || call.AimedArrivalTime;
        var minutes = getMinutesUntil(expectedTime);

        arrivals.push({
          route: journey.PublishedLineName || journey.LineRef,
          destination: journey.DestinationName || '',
          minutes: minutes
        });
      }
    } catch (e) {
      console.error('Parse error:', e);
    }
    return arrivals;
  }

  // Render a single stop
  function renderStop(stop, arrivals) {
    var html = '<div class="stop">';
    html += '<div class="stop-header">' + escapeHtml(stop.name || stop.stopCode) + '</div>';

    if (arrivals.length === 0) {
      html += '<div class="no-arrivals">No arrivals scheduled</div>';
    } else {
      for (var i = 0; i < arrivals.length; i++) {
        var a = arrivals[i];
        var timeDisplay = a.minutes === 0 ? 'Now' : a.minutes + ' <span class="time-unit">min</span>';
        html += '<div class="arrival">';
        html += '<span class="route">' + escapeHtml(a.route) + '</span>';
        html += '<span class="destination">' + escapeHtml(a.destination) + '</span>';
        html += '<span class="time">' + timeDisplay + '</span>';
        html += '</div>';
      }
    }

    html += '</div>';
    return html;
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Update the last updated timestamp
  function updateTimestamp() {
    var el = document.getElementById('last-updated');
    if (el) {
      var now = new Date();
      var hours = now.getHours();
      var minutes = now.getMinutes();
      var ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      minutes = minutes < 10 ? '0' + minutes : minutes;
      el.textContent = 'Updated ' + hours + ':' + minutes + ' ' + ampm;
    }
  }

  // Main refresh function
  function refreshAll() {
    var stops = getStops();
    var container = document.getElementById('stops-container');

    if (stops.length === 0) {
      container.innerHTML = '<p class="no-stops">No stops configured. <a href="/settings.html">Add stops</a></p>';
      return;
    }

    var results = [];
    var pending = stops.length;

    for (var i = 0; i < stops.length; i++) {
      (function(index, stop) {
        fetchArrivals(stop, function(err, data) {
          if (err) {
            results[index] = { stop: stop, arrivals: [], error: true };
          } else {
            results[index] = { stop: stop, arrivals: parseArrivals(data) };
          }

          pending--;
          if (pending === 0) {
            // All fetches complete, render
            var html = '';
            for (var j = 0; j < results.length; j++) {
              html += renderStop(results[j].stop, results[j].arrivals);
            }
            container.innerHTML = html;
            updateTimestamp();
          }
        });
      })(i, stops[i]);
    }
  }

  // Initialize
  function init() {
    showGreeting();
    // Fetch server config first, then start refreshing
    fetchConfig(function() {
      refreshAll();
      refreshWeather();
      setInterval(refreshAll, REFRESH_INTERVAL);
      setInterval(refreshWeather, REFRESH_INTERVAL * 5); // Weather every 5 minutes
    });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
