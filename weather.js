/**
 * KampTrail Weather Module
 * Provides weather data for campsite locations using Open-Meteo API
 */
(function () {
  'use strict';

  const WEATHER_API = 'https://api.open-meteo.com/v1/forecast';
  const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

  const weatherCache = new Map();

  /**
   * Fetch weather data for a location
   */
  async function fetchWeather(lat, lng) {
    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const cached = weatherCache.get(cacheKey);

    // Return cached data if still fresh
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    try {
      const params = new URLSearchParams({
        latitude: lat.toFixed(4),
        longitude: lng.toFixed(4),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
        temperature_unit: 'fahrenheit',
        wind_speed_unit: 'mph',
        precipitation_unit: 'inch',
        timezone: 'auto',
        forecast_days: 3
      });

      const response = await fetch(`${WEATHER_API}?${params}`);
      if (!response.ok) throw new Error('Weather API failed');

      const data = await response.json();

      // Cache the result
      weatherCache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      return data;
    } catch (err) {
      console.error('Weather fetch failed:', err);
      return null;
    }
  }

  /**
   * Get weather icon/emoji based on WMO weather code
   * https://open-meteo.com/en/docs
   */
  function getWeatherIcon(code) {
    if (code === 0) return '☀️'; // Clear
    if (code === 1 || code === 2) return '🌤️'; // Mainly clear, partly cloudy
    if (code === 3) return '☁️'; // Overcast
    if (code >= 45 && code <= 48) return '🌫️'; // Fog
    if (code >= 51 && code <= 57) return '🌧️'; // Drizzle
    if (code >= 61 && code <= 67) return '🌧️'; // Rain
    if (code >= 71 && code <= 77) return '❄️'; // Snow
    if (code >= 80 && code <= 82) return '🌧️'; // Rain showers
    if (code >= 85 && code <= 86) return '❄️'; // Snow showers
    if (code >= 95 && code <= 99) return '⛈️'; // Thunderstorm
    return '🌡️';
  }

  /**
   * Get weather description from WMO code
   */
  function getWeatherDescription(code) {
    if (code === 0) return 'Clear sky';
    if (code === 1) return 'Mainly clear';
    if (code === 2) return 'Partly cloudy';
    if (code === 3) return 'Overcast';
    if (code >= 45 && code <= 48) return 'Fog';
    if (code >= 51 && code <= 55) return 'Drizzle';
    if (code >= 56 && code <= 57) return 'Freezing drizzle';
    if (code >= 61 && code <= 65) return 'Rain';
    if (code >= 66 && code <= 67) return 'Freezing rain';
    if (code >= 71 && code <= 75) return 'Snow';
    if (code === 77) return 'Snow grains';
    if (code >= 80 && code <= 82) return 'Rain showers';
    if (code >= 85 && code <= 86) return 'Snow showers';
    if (code === 95) return 'Thunderstorm';
    if (code >= 96 && code <= 99) return 'Thunderstorm with hail';
    return 'Unknown';
  }

  /**
   * Get wind direction from degrees
   */
  function getWindDirection(degrees) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(degrees / 45) % 8;
    return dirs[index];
  }

  /**
   * Format weather data for display in popup
   */
  function formatWeatherHTML(weather) {
    if (!weather || !weather.current) {
      return '<div style="padding:8px;color:#999;font-size:12px">Weather data unavailable</div>';
    }

    const current = weather.current;
    const daily = weather.daily;

    const icon = getWeatherIcon(current.weather_code);
    const desc = getWeatherDescription(current.weather_code);
    const temp = Math.round(current.temperature_2m);
    const feelsLike = Math.round(current.apparent_temperature);
    const humidity = Math.round(current.relative_humidity_2m);
    const wind = Math.round(current.wind_speed_10m);
    const windDir = getWindDirection(current.wind_direction_10m);

    let html = `
      <div style="border-top:1px solid rgba(255,255,255,.1);margin-top:8px;padding-top:8px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">🌤️ Weather</div>

        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:32px">${icon}</span>
          <div>
            <div style="font-size:24px;font-weight:700">${temp}°F</div>
            <div style="font-size:11px;color:#9fd0ff">${desc}</div>
          </div>
        </div>

        <div style="font-size:11px;color:#b7c7d6;display:grid;grid-template-columns:1fr 1fr;gap:4px">
          <div>Feels like: ${feelsLike}°F</div>
          <div>Humidity: ${humidity}%</div>
          <div>Wind: ${wind} mph ${windDir}</div>
          ${current.precipitation > 0 ? `<div>Rain: ${current.precipitation}"</div>` : ''}
        </div>
    `;

    // 3-day forecast
    if (daily && daily.time && daily.time.length >= 3) {
      html += `
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1)">
          <div style="font-size:11px;font-weight:600;margin-bottom:4px">3-Day Forecast</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;font-size:10px;text-align:center">
      `;

      for (let i = 0; i < Math.min(3, daily.time.length); i++) {
        const date = new Date(daily.time[i]);
        const dayName = i === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayIcon = getWeatherIcon(daily.weather_code[i]);
        const high = Math.round(daily.temperature_2m_max[i]);
        const low = Math.round(daily.temperature_2m_min[i]);
        const precip = daily.precipitation_probability_max[i];

        html += `
          <div style="padding:4px;background:rgba(134,183,255,.05);border-radius:4px">
            <div style="font-weight:600">${dayName}</div>
            <div style="font-size:16px;margin:2px 0">${dayIcon}</div>
            <div>${high}° / ${low}°</div>
            ${precip > 0 ? `<div style="color:#86b7ff">${precip}% 🌧️</div>` : ''}
          </div>
        `;
      }

      html += `
          </div>
        </div>
      `;
    }

    html += `</div>`;
    return html;
  }

  /**
   * Add weather to a campsite popup
   */
  async function addWeatherToPopup(lat, lng, popupElement) {
    // Add loading placeholder
    const weatherDiv = document.createElement('div');
    weatherDiv.id = 'weather-container';
    weatherDiv.innerHTML = '<div style="padding:8px;text-align:center;color:#999;font-size:12px">Loading weather...</div>';

    if (popupElement) {
      popupElement.appendChild(weatherDiv);
    }

    // Fetch weather
    const weather = await fetchWeather(lat, lng);

    // Update with actual weather or error
    if (weatherDiv) {
      weatherDiv.innerHTML = formatWeatherHTML(weather);
    }
  }

  /**
   * Create weather popup content for a location
   */
  async function getWeatherHTML(lat, lng) {
    const weather = await fetchWeather(lat, lng);
    return formatWeatherHTML(weather);
  }

  // Export
  window.KampTrailWeather = {
    fetchWeather,
    addWeatherToPopup,
    getWeatherHTML,
    formatWeatherHTML
  };
})();
