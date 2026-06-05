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
