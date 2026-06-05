// Pure, browser-agnostic weather helpers. No DOM/fetch here.

// code -> [label, group]
export const CODE_TABLE = {
  0: ['Clear sky', 'clear'],
  1: ['Mainly clear', 'clear'],
  2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'],
  48: ['Rime fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Dense drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'],
  57: ['Dense freezing drizzle', 'drizzle'],
  61: ['Slight rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Heavy freezing rain', 'rain'],
  71: ['Slight snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Slight showers', 'rain'],
  81: ['Showers', 'rain'],
  82: ['Violent showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'thunder'],
  96: ['Thunderstorm w/ hail', 'thunder'],
  99: ['Thunderstorm w/ heavy hail', 'thunder'],
};

const GROUP_ICON = {
  clear:   (d) => (d ? 'sun' : 'moon'),
  partly:  (d) => (d ? 'partly-day' : 'partly-night'),
  cloudy:  () => 'cloud',
  fog:     () => 'fog',
  drizzle: () => 'rain',
  rain:    () => 'rain',
  snow:    () => 'snow',
  thunder: () => 'thunder',
};

const GROUP_THEME = {
  clear:   (d) => (d ? 'clear-day' : 'clear-night'),
  partly:  (d) => (d ? 'partly-day' : 'partly-night'),
  cloudy:  () => 'cloudy',
  fog:     () => 'fog',
  drizzle: () => 'rain',
  rain:    () => 'rain',
  snow:    () => 'snow',
  thunder: () => 'thunder',
};

export function describeWeather(code, isDay) {
  const day = !!Number(isDay);
  const entry = CODE_TABLE[code];
  const label = entry ? entry[0] : 'Unknown';
  const group = entry ? entry[1] : 'cloudy';
  return {
    label,
    icon: GROUP_ICON[group](day),
    theme: GROUP_THEME[group](day),
  };
}
