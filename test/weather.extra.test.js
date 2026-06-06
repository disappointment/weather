import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  airQualityUrl, parseAirQuality, aqiCategory,
  sliceDayHours, parseMinutely, nowcastText,
  sliceNext24, groupHours,
} from '../weather.js';

test('airQualityUrl builds an air-quality endpoint with coords and pollutants', () => {
  const u = airQualityUrl(47.6, -122.3);
  assert.match(u, /^https:\/\/air-quality-api\.open-meteo\.com\/v1\/air-quality\?/);
  assert.match(u, /latitude=47\.6/);
  assert.match(u, /longitude=-122\.3/);
  assert.match(u, /current=us_aqi/);
  assert.match(u, /pm2_5/);
  assert.match(u, /pm10/);
  assert.match(u, /ozone/);
  assert.match(u, /european_aqi/);
  assert.match(u, /timezone=auto/);
});

test('parseAirQuality reads json.current with undefined-safe access', () => {
  const out = parseAirQuality({
    current: { us_aqi: 42, pm2_5: 9.1, pm10: 15, ozone: 60, european_aqi: 20 },
  });
  assert.deepEqual(out, { usAqi: 42, pm25: 9.1, pm10: 15, ozone: 60, europeanAqi: 20 });
  // missing current -> all undefined, no throw
  assert.deepEqual(parseAirQuality({}), {
    usAqi: undefined, pm25: undefined, pm10: undefined,
    ozone: undefined, europeanAqi: undefined,
  });
  assert.deepEqual(parseAirQuality(null), {
    usAqi: undefined, pm25: undefined, pm10: undefined,
    ozone: undefined, europeanAqi: undefined,
  });
});

test('aqiCategory maps US AQI breakpoints', () => {
  assert.equal(aqiCategory(0), 'Good');
  assert.equal(aqiCategory(50), 'Good');
  assert.equal(aqiCategory(51), 'Moderate');
  assert.equal(aqiCategory(100), 'Moderate');
  assert.equal(aqiCategory(101), 'Unhealthy for sensitive');
  assert.equal(aqiCategory(150), 'Unhealthy for sensitive');
  assert.equal(aqiCategory(151), 'Unhealthy');
  assert.equal(aqiCategory(200), 'Unhealthy');
  assert.equal(aqiCategory(201), 'Very unhealthy');
  assert.equal(aqiCategory(300), 'Very unhealthy');
  assert.equal(aqiCategory(301), 'Hazardous');
  assert.equal(aqiCategory(500), 'Hazardous');
  assert.equal(aqiCategory(NaN), 'Unknown');
  assert.equal(aqiCategory(undefined), 'Unknown');
});

function fakeDayHourly() {
  const time = [], temperature_2m = [], weather_code = [], is_day = [],
        precipitation_probability = [], wind_speed_10m = [],
        relative_humidity_2m = [], uv_index = [], visibility = [],
        apparent_temperature = [], dew_point_2m = [], wind_gusts_10m = [],
        cloud_cover = [];
  // two days, 3 hours each
  const stamps = [
    '2026-06-06T00:00', '2026-06-06T01:00', '2026-06-06T02:00',
    '2026-06-07T00:00', '2026-06-07T01:00', '2026-06-07T02:00',
  ];
  stamps.forEach((t, i) => {
    time.push(t);
    temperature_2m.push(60 + i);
    weather_code.push(i % 3);
    is_day.push(i % 2);
    precipitation_probability.push(i * 5);
    wind_speed_10m.push(5 + i);
    relative_humidity_2m.push(50 + i);
    uv_index.push(i % 11);
    visibility.push(16090);
    apparent_temperature.push(58 + i);
    dew_point_2m.push(40 + i);
    wind_gusts_10m.push(10 + i);
    cloud_cover.push(i * 10);
  });
  return {
    time, temperature_2m, weather_code, is_day, precipitation_probability,
    wind_speed_10m, relative_humidity_2m, uv_index, visibility,
    apparent_temperature, dew_point_2m, wind_gusts_10m, cloud_cover,
  };
}

test('sliceDayHours returns only the requested calendar day in full shape', () => {
  const hourly = fakeDayHourly();
  const day1 = sliceDayHours(hourly, '2026-06-06');
  assert.equal(day1.length, 3);
  assert.equal(day1[0].time, '2026-06-06T00:00');
  assert.equal(day1[0].temp, 60);
  assert.equal(day1[0].feels, 58);
  assert.equal(day1[0].dew, 40);
  assert.equal(day1[0].gust, 10);
  assert.equal(day1[0].cloud, 0);
  assert.equal(day1[2].time, '2026-06-06T02:00');

  const day2 = sliceDayHours(hourly, '2026-06-07');
  assert.equal(day2.length, 3);
  assert.equal(day2[0].time, '2026-06-07T00:00');

  // no match -> empty
  assert.deepEqual(sliceDayHours(hourly, '1999-01-01'), []);
});

test('sliceNext24 carries the feels/dew/gust/cloud fields through', () => {
  const hourly = fakeDayHourly();
  // current sits on the first stamp -> slice starts there
  const out = sliceNext24(hourly, '2026-06-06T00:30');
  assert.equal(out.length, 6);            // only 6 hours exist in the fixture
  assert.equal(out[0].time, '2026-06-06T00:00');
  assert.equal(out[0].temp, 60);
  assert.equal(out[0].feels, 58);
  assert.equal(out[0].dew, 40);
  assert.equal(out[0].gust, 10);
  assert.equal(out[0].cloud, 0);
  assert.equal(out[0].humidity, 50);
  assert.equal(out[1].feels, 59);
  assert.equal(out[1].gust, 11);
});

test('sliceNext24 leaves new fields undefined when arrays are absent', () => {
  // older cached payloads may lack the newer hourly arrays; must not throw
  const hourly = {
    time: ['2026-06-06T00:00'],
    temperature_2m: [60],
    weather_code: [0],
    is_day: [1],
    precipitation_probability: [0],
    uv_index: [0],
    visibility: [16090],
  };
  const out = sliceNext24(hourly, '2026-06-06T00:00');
  assert.equal(out.length, 1);
  assert.equal(out[0].temp, 60);
  assert.equal(out[0].feels, undefined);
  assert.equal(out[0].dew, undefined);
  assert.equal(out[0].gust, undefined);
  assert.equal(out[0].cloud, undefined);
  assert.equal(out[0].wind, undefined);
  assert.equal(out[0].humidity, undefined);
});

test('groupHours averages feels alongside temp', () => {
  const hours = [
    { time: 'T0', isDay: 1, temp: 60, precip: 10, wind: 4, humidity: 40, feels: 58, code: 1 },
    { time: 'T1', isDay: 1, temp: 66, precip: 60, wind: 9, humidity: 50, feels: 64, code: 61 },
    { time: 'T2', isDay: 0, temp: 63, precip: 20, wind: 6, humidity: 60, feels: 67, code: 2 },
  ];
  const [b] = groupHours(hours, 3);
  assert.equal(b.feels, (58 + 64 + 67) / 3);  // avg(58,64,67)=63
  assert.equal(b.temp, 63);                     // avg(60,66,63)=63
  assert.equal(b.humidity, 50);                 // avg(40,50,60)=50
});

test('groupHours leaves feels undefined when no finite samples', () => {
  const hours = [
    { time: 'T0', isDay: 1, temp: 60, precip: 10, wind: 4, feels: null, code: 1 },
    { time: 'T1', isDay: 1, temp: 66, precip: 20, wind: 5, feels: NaN, code: 2 },
  ];
  const [b] = groupHours(hours, 3);
  assert.equal(b.feels, undefined);
  assert.equal(b.temp, 63);  // temps still averaged
});

test('parseMinutely keeps samples at/after current time, capped to 12h', () => {
  const time = [], precipitation = [];
  // 50 quarter-hour stamps starting at 00:00; current = 00:15 (drops index 0)
  for (let i = 0; i < 50; i++) {
    const total = i * 15;
    const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    time.push(`2026-06-06T${hh}:${mm}`);
    precipitation.push(i * 0.01);
  }
  const data = {
    current: { time: '2026-06-06T00:15' },
    minutely_15: { time, precipitation },
  };
  const out = parseMinutely(data);
  assert.equal(out.length, 48);            // capped to next 12h
  assert.equal(out[0].time, '2026-06-06T00:15');
  assert.equal(out[0].precip, precipitation[1]);

  // missing minutely_15 -> empty, no throw
  assert.deepEqual(parseMinutely({ current: { time: 'x' } }), []);
  assert.deepEqual(parseMinutely(null), []);
});

test('nowcastText: dry forecast', () => {
  const samples = [
    { time: '2026-06-06T00:00', precip: 0 },
    { time: '2026-06-06T00:15', precip: 0 },
  ];
  assert.equal(nowcastText(samples), 'No precipitation expected in the next 12 h.');
  assert.equal(nowcastText([]), 'No precipitation expected in the next 12 h.');
});

test('nowcastText: raining now', () => {
  const samples = [
    { time: '2026-06-06T00:00', precip: 1.25 },
    { time: '2026-06-06T00:15', precip: 0.8 },
  ];
  assert.equal(nowcastText(samples), 'Precipitation now, ~1.3mm/h.');
});

test('nowcastText: non-finite precip samples are ignored', () => {
  // all-missing data reads as dry rather than throwing
  assert.equal(
    nowcastText([{ time: 't', precip: null }, { time: 't', precip: NaN }]),
    'No precipitation expected in the next 12 h.',
  );
  assert.equal(nowcastText(null), 'No precipitation expected in the next 12 h.');
  // leading gaps are skipped; the first finite-but-dry sample drives "now"
  const samples = [
    { time: '2026-06-06T00:00', precip: undefined },
    { time: '2026-06-06T00:15', precip: 0.9 },
  ];
  assert.equal(nowcastText(samples), 'Precipitation now, ~0.9mm/h.');
});

test('nowcastText: rain likely later names the first wet sample', () => {
  const samples = [
    { time: '2026-06-06T00:00', precip: 0 },
    { time: '2026-06-06T00:15', precip: 0.1 },   // below 0.2 threshold
    { time: '2026-06-06T14:30', precip: 0.5 },
  ];
  const expected = new Date('2026-06-06T14:30').toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
  assert.equal(nowcastText(samples), `Precipitation likely around ${expected}.`);
});
