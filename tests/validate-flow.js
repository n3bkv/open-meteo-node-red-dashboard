#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const flows = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../flows.json'), 'utf8'));
const byId = new Map(flows.map(n => [n.id, n]));
const nodesOfType = t => flows.filter(n => n.type === t);
const getByName = s => flows.find(n => n.name === s);

assert.equal(byId.size, flows.length, 'Duplicate node IDs');
for (const n of flows) {
  if (n.z) assert(byId.has(n.z), `Missing flow for ${n.id}`);
  if (n.group) assert(byId.has(n.group), `Missing group for ${n.id}`);
  if (n.type === 'ui_group') assert(byId.has(n.tab), `Missing dashboard tab for ${n.id}`);
  for (const output of n.wires || []) {
    for (const dest of output) assert(byId.has(dest), `Missing destination ${dest} for ${n.id}`);
  }
  if (n.type === 'function') {
    assert.doesNotThrow(() => new Function('msg','flow','node','env',n.func), `Invalid function: ${n.name}`);
    assert.equal((n.wires || []).length, n.outputs, `Output/wire count mismatch for ${n.name}`);
  }
}
assert.equal(nodesOfType('ui_chart').length, 17, 'Expected 17 charts');
assert.equal(nodesOfType('ui_tab').length, 6, 'Expected six dashboard tabs');

function execute(n, msg, flow, envVars = {}) {
  const messages = [];
  const fakeNode = {
    warn: m => messages.push(String(m)),
    error: m => { throw new Error(m); }
  };
  const env = { get: key => envVars[key] };
  const fn = new Function('msg','flow','node','env',n.func);
  return {value: fn(msg, flow, fakeNode, env), messages};
}
function createFlow() {
  const ctx = new Map();
  return { get: k => ctx.get(k), set: (k,v) => ctx.set(k,v) };
}
const config = getByName('CONFIG | location & Open-Meteo APIs');
const flow = createFlow();
const sample = {WX_LAT:'47.6062', WX_LON:'-122.3321', WX_TIMEZONE:'America/Los_Angeles', WX_LABEL:'Seattle'};
for (const [topic, outIndex, host] of [
  ['forecast',0,'api.open-meteo.com'],
  ['air',1,'air-quality-api.open-meteo.com'],
  ['archive',2,'archive-api.open-meteo.com']
]) {
  const result = execute(config,{topic},flow,sample).value;
  assert.equal(result.length,3,'Three HTTP dispatch outputs required');
  assert(result[outIndex],`Missing ${topic} message`);
  assert.equal(result.filter(Boolean).length,1,'One request per trigger');
  const u = new URL(result[outIndex].url);
  assert.equal(u.host,host);
  assert.equal(u.searchParams.get('latitude'),'47.6062');
  assert.equal(u.searchParams.get('longitude'),'-122.3321');
  assert.equal(u.searchParams.get('timezone'),'America/Los_Angeles');
  assert.equal(u.searchParams.get('timeformat'),'unixtime');
  assert.equal(result[outIndex]._feed,topic);
}
assert.equal(flow.get('wx_config').location,'Seattle');
flow.set('wx_forecast', {old:true});
flow.set('wx_air', {old:true});
execute(config, {topic:'forecast'}, flow, {...sample,WX_LAT:'40'});
assert.equal(flow.get('wx_forecast'),null,'Location change must clear previous forecast');
assert.equal(flow.get('wx_air'),null,'Location change must clear previous air quality');

const router = getByName('Route 17 charts | 1:1 mapping');
const chartIds = nodesOfType('ui_chart').map(n=>n.id);
assert.equal(router.outputs,17);
assert.deepEqual(router.wires,chartIds.map(id=>[id]),'Chart output must point to matching node');
const keys=['temp','humidity','pressure','wind','precip','pop','uv','solar','vpd','soil','dailyTemp','dailyRain','aqi','particulate','climateTemp','climateRain','climateWind'];
const sampleCharts = Object.fromEntries(keys.map(k=>[k,[{series:['A'],data:[[{x:Date.now(),y:1}]],labels:['']}]]));
const routes=execute(router,{payload:{charts:sampleCharts}},flow).value;
assert.equal(routes.length,17);
for(let i=0;i<17;i++) assert.deepEqual(routes[i].payload,sampleCharts[keys[i]],'Chart order mismatch');

const catchFn=getByName('Identify failed request');
for (const [id,feed] of [['9bc0698a11f9c421','forecast'],['46cf342cabcb8d62','air'],['b79e6dbb92e55071','archive']]) {
  const result=execute(catchFn,{source:{id},error:{message:'Network down'}},flow).value;
  assert.equal(result._feed,feed);
  assert.equal(result.statusCode,599);
}

const storeFn=getByName('Store API results / errors');
const forecastData={current:{temperature_2m:70},hourly:{time:[1]},daily:{time:[1]}};
assert(execute(storeFn,{_feed:'forecast',statusCode:200,payload:forecastData},flow).value);
assert.equal(flow.get('wx_diag').forecast.state,'ok');
execute(storeFn,{_feed:'forecast',statusCode:500,payload:{reason:'upstream failure'}},flow);
assert.deepEqual(flow.get('wx_forecast'),forecastData,'Network error must keep last good data');
assert.equal(flow.get('wx_diag').forecast.state,'error');
// Run the full analytics function against representative API-shaped fixtures.
// This checks its output shape and prevents a refactor from silently breaking rendering.
const hourMs = 3600000;
const dayMs = 86400000;
const nowMs = Date.now();
const hourlyTimes = Array.from({length:337},(_,i)=>Math.floor((nowMs - 7*dayMs + i*hourMs)/1000));
const forecastDailyTimes = Array.from({length:14},(_,i)=>Math.floor((nowMs - 7*dayMs + i*dayMs)/1000));
const archiveTimes = Array.from({length:60},(_,i)=>Math.floor((nowMs - (67-i)*dayMs)/1000));
function series(time, names, overrides={}) {
  const obj={time};
  for (const k of names) obj[k]=time.map((_,i)=>(overrides[k]===undefined? 3 : overrides[k]));
  return obj;
}
const hourly = series(hourlyTimes, [
 'temperature_2m','relative_humidity_2m','dew_point_2m','apparent_temperature',
 'precipitation_probability','precipitation','rain','weather_code','pressure_msl',
 'cloud_cover','visibility','uv_index','shortwave_radiation','et0_fao_evapotranspiration',
 'wind_speed_10m','wind_direction_10m','wind_gusts_10m','soil_temperature_0cm',
 'soil_moisture_0_to_1cm','vapour_pressure_deficit'
],{weather_code:0,precipitation:0.01,temperature_2m:70,relative_humidity_2m:50,pressure_msl:1013,wind_speed_10m:4});
const dailyFields=[
 'weather_code','temperature_2m_max','temperature_2m_min','temperature_2m_mean',
 'apparent_temperature_max','apparent_temperature_min','uv_index_max',
 'precipitation_sum','precipitation_probability_max','precipitation_hours',
 'wind_speed_10m_max','wind_gusts_10m_max','sunrise','sunset','daylight_duration',
 'sunshine_duration','shortwave_radiation_sum','et0_fao_evapotranspiration'
];
const daily=series(forecastDailyTimes,dailyFields,{
  weather_code:0,temperature_2m_max:75,temperature_2m_min:55,
  temperature_2m_mean:65,precipitation_sum:0.1,daylight_duration:43200
});
daily.sunrise=forecastDailyTimes.map(t=>t+6*3600);
daily.sunset=forecastDailyTimes.map(t=>t+18*3600);
const archiveDaily=series(archiveTimes,[
 'temperature_2m_max','temperature_2m_min','temperature_2m_mean','precipitation_sum',
 'wind_speed_10m_max','wind_gusts_10m_max','shortwave_radiation_sum','et0_fao_evapotranspiration'
],{temperature_2m_max:70,temperature_2m_min:50,temperature_2m_mean:60,precipitation_sum:0.05});
const weatherPayload = {
  timezone:'America/Los_Angeles',utc_offset_seconds:-28800,
  latitude:47.6062,longitude:-122.3321,
  current:{
    time:Math.floor(nowMs/1000),is_day:1,temperature_2m:70,
    apparent_temperature:69,relative_humidity_2m:50,dew_point_2m:48,
    weather_code:0,pressure_msl:1013,wind_speed_10m:5,wind_gusts_10m:8,
    wind_direction_10m:270,cloud_cover:20,uv_index:3,shortwave_radiation:300,
    visibility:10000,vapour_pressure_deficit:0.6,soil_temperature_0cm:60,
    soil_moisture_0_to_1cm:0.2
  },hourly,daily
};
flow.set('wx_config',{lat:47.6062,lon:-122.3321,timezone:'America/Los_Angeles',location:'Seattle'});
flow.set('wx_forecast',weatherPayload);
flow.set('wx_air',{
  current:{time:Math.floor(nowMs/1000),us_aqi:25,pm2_5:5,pm10:10,ozone:20,
    nitrogen_dioxide:5,carbon_monoxide:150,sulphur_dioxide:1},
  hourly:series(hourlyTimes,['us_aqi','pm2_5','pm10','ozone'])
});
flow.set('wx_archive',{timezone:'America/Los_Angeles',utc_offset_seconds:-28800,daily:archiveDaily});
const analytics = getByName('Compute all weather analytics');
const output = execute(analytics,{topic:'render'},flow).value;
assert(output && output.payload,'Analytics produced no payload');
assert.equal(output.payload.meta.location,'Seattle');
assert.equal(output.payload.meta.timezone,'America/Los_Angeles');
assert.equal(output.payload.tiles.length,12,'Expected 12 current-data tiles');
assert.equal(output.payload.air.label,'Good');
assert.equal(output.payload.climate.available,60,'Expected 60 archive days');
assert.equal(Object.keys(output.payload.charts).length,17);
assert(output.payload.forecast.length>=6,'Missing seven-day outlook');
const finalChartOutput=execute(router,output,flow).value;
assert.equal(finalChartOutput.length,17);
assert(finalChartOutput.every(Boolean),'Synthetic data should populate every chart');
console.log('PASS: 51-node export, JS syntax, three APIs, environment overrides, cache reset, error routing/fallback, full analytics fixture, and all 17 chart outputs.');
