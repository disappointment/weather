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
  floorToHour, degToCompass, metersToMiles, rangeBar,
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

test('rangeBar computes left/width percentages', () => {
  const b = rangeBar(60, 78, 55, 80);
  assert.equal(b.left, 20);   // (60-55)/(80-55)=0.2
  assert.equal(b.width, 72);  // (78-60)/(80-55)=0.72
  // degenerate week range -> full-width bar, no NaN
  const flat = rangeBar(70, 70, 70, 70);
  assert.equal(flat.left, 0);
  assert.equal(flat.width, 100);
});
