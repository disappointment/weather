import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWeather } from '../weather.js';

test('describeWeather: clear day vs night', () => {
  const day = describeWeather(0, 1);
  assert.equal(day.label, 'Clear sky');
  assert.equal(day.icon, 'sun');
  assert.equal(day.theme, 'clear-day');

  const night = describeWeather(0, 0);
  assert.equal(night.icon, 'moon');
  assert.equal(night.theme, 'clear-night');
});

test('describeWeather: partly cloudy switches day/night', () => {
  assert.equal(describeWeather(2, 1).icon, 'partly-day');
  assert.equal(describeWeather(2, 0).icon, 'partly-night');
  assert.equal(describeWeather(2, 1).theme, 'partly-day');
});

test('describeWeather: rain/snow/thunder groups', () => {
  assert.equal(describeWeather(65, 1).icon, 'rain');
  assert.equal(describeWeather(65, 1).theme, 'rain');
  assert.equal(describeWeather(75, 0).icon, 'snow');
  assert.equal(describeWeather(95, 1).icon, 'thunder');
  assert.equal(describeWeather(45, 1).icon, 'fog');
});

test('describeWeather: unknown code falls back', () => {
  const r = describeWeather(123, 1);
  assert.equal(r.label, 'Unknown');
  assert.equal(r.icon, 'cloud');
  assert.equal(r.theme, 'cloudy');
});

import {
  floorToHour, degToCompass, metersToMiles, metersToKm, rangeBar, unitConfig,
} from '../weather.js';

test('floorToHour truncates to the hour', () => {
  assert.equal(floorToHour('2026-06-04T21:15'), '2026-06-04T21:00');
  assert.equal(floorToHour('2026-06-04T21:00'), '2026-06-04T21:00');
});

test('degToCompass maps to 8-point compass', () => {
  assert.equal(degToCompass(0), 'N');
  assert.equal(degToCompass(45), 'NE');
  assert.equal(degToCompass(90), 'E');
  assert.equal(degToCompass(200), 'S');
  assert.equal(degToCompass(359), 'N');
});

test('metersToMiles rounds to 1 decimal', () => {
  assert.equal(metersToMiles(1609), 1);
  assert.equal(metersToMiles(16090), 10);
  assert.equal(metersToMiles(8045), 5);
});

test('metersToKm rounds to 1 decimal', () => {
  assert.equal(metersToKm(1000), 1);
  assert.equal(metersToKm(16090), 16.1);
  assert.equal(metersToKm(500), 0.5);
});

test('unitConfig: imperial for fahrenheit, metric for celsius', () => {
  const f = unitConfig('fahrenheit');
  assert.equal(f.windSpeedUnit, 'mph');
  assert.equal(f.precipitationUnit, 'inch');
  assert.equal(f.windLabel, 'mph');
  assert.equal(f.distanceLabel, 'mi');
  assert.equal(f.distanceFrom(1609), 1);

  const c = unitConfig('celsius');
  assert.equal(c.windSpeedUnit, 'kmh');
  assert.equal(c.precipitationUnit, 'mm');
  assert.equal(c.windLabel, 'km/h');
  assert.equal(c.distanceLabel, 'km');
  assert.equal(c.distanceFrom(1000), 1);
});

test('rangeBar computes left/width percentages', () => {
  const b = rangeBar(60, 78, 55, 80);
  assert.equal(b.left, 20);   // (60-55)/(80-55)=0.2
  assert.equal(b.width, 72);  // (78-60)/(80-55)=0.72
  // degenerate week range -> full-width bar, no NaN
  const flat = rangeBar(70, 70, 70, 70);
  assert.equal(flat.left, 0);
  assert.equal(flat.width, 100);
});

import { sliceNext24 } from '../weather.js';

function fakeHourly(startHour, n) {
  const time = [], temperature_2m = [], weather_code = [],
        is_day = [], precipitation_probability = [],
        uv_index = [], visibility = [];
  for (let i = 0; i < n; i++) {
    const h = String((startHour + i) % 24).padStart(2, '0');
    const day = Math.floor((startHour + i) / 24);
    time.push(`2026-06-${String(4 + day).padStart(2, '0')}T${h}:00`);
    temperature_2m.push(60 + i);
    weather_code.push(i % 3);
    is_day.push(1);
    precipitation_probability.push(i);
    uv_index.push(i % 11);
    visibility.push(16090);
  }
  return { time, temperature_2m, weather_code, is_day,
           precipitation_probability, uv_index, visibility };
}

test('sliceNext24 returns 24 entries starting at the current hour', () => {
  const hourly = fakeHourly(0, 48);
  const out = sliceNext24(hourly, '2026-06-04T05:30');
  assert.equal(out.length, 24);
  assert.equal(out[0].time, '2026-06-04T05:00');
  assert.equal(out[0].temp, 65);
  assert.equal(out[0].precip, 5);
  assert.equal(out[0].uv, 5);
  assert.equal(out[0].visibility, 16090);
});

test('sliceNext24 clamps when near the end of the array', () => {
  const hourly = fakeHourly(0, 10);
  const out = sliceNext24(hourly, '2026-06-04T08:00');
  assert.equal(out.length, 2); // only hours 08,09 remain
});

test('sliceNext24 falls back to index 0 when time not found', () => {
  const hourly = fakeHourly(0, 24);
  const out = sliceNext24(hourly, '1999-01-01T00:00');
  assert.equal(out[0].time, '2026-06-04T00:00');
});

import {
  forecastUrl, geocodeUrl, reverseGeocodeUrl, parsePlaces,
} from '../weather.js';

test('forecastUrl includes coords, unit, and blocks', () => {
  const u = forecastUrl(47.6, -122.3, 'fahrenheit');
  assert.match(u, /latitude=47\.6/);
  assert.match(u, /longitude=-122\.3/);
  assert.match(u, /temperature_unit=fahrenheit/);
  assert.match(u, /wind_speed_unit=mph/);
  assert.match(u, /timezone=auto/);
  assert.match(u, /current=/);
  assert.match(u, /hourly=/);
  assert.match(u, /daily=/);
  assert.match(u, /uv_index/);
});

test('geocodeUrl encodes the query', () => {
  assert.match(geocodeUrl('San Juan'), /name=San(\+|%20)Juan/);
  assert.match(geocodeUrl('x'), /count=5/);
});

test('reverseGeocodeUrl includes lat/lon', () => {
  const u = reverseGeocodeUrl(47.6, -122.3);
  assert.match(u, /latitude=47\.6/);
  assert.match(u, /longitude=-122\.3/);
});

test('parsePlaces maps results and handles empties', () => {
  const json = { results: [
    { name: 'Seattle', admin1: 'Washington', country: 'United States',
      latitude: 47.6, longitude: -122.3 },
    { name: 'Paris', country: 'France', latitude: 48.8, longitude: 2.3 },
  ]};
  const out = parsePlaces(json);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Seattle, Washington, United States');
  assert.equal(out[0].lat, 47.6);
  assert.equal(out[1].name, 'Paris, France');
  assert.deepEqual(parsePlaces({}), []);
});
