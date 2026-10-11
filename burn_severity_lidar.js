/******************************************************************************
 * Wildfire Burn Severity & Forest Structure — Saskatchewan
 * Google Earth Engine (Code Editor, JavaScript)
 *
 * What it does
 *   1. Builds cloud-masked Landsat 5/7/8/9 composites (harmonized to OLI)
 *   2. Computes NBR, dNBR, RdNBR and RBR for one fire year
 *   3. Classifies severity with USGS FIREMON (Key & Benson 2006) thresholds
 *   4. Builds a 2000–present annual NBR time series: burned vs unburned forest
 *   5. Relates burn severity to pre-fire canopy height
 *      (ETH Global Canopy Height 2020, calibrated on GEDI spaceborne LiDAR)
 *   6. Exports rasters + CSV tables to Google Drive
 *
 * Author: Uday Karmoker
 ******************************************************************************/

// ============================ USER SETTINGS =================================

// Fire year to analyse (pre-fire = previous summer, post-fire = next summer)
var FIRE_YEAR = 2025;

// Area of interest. Example: Amisk Lake / Denare Beach area, east-central
// Saskatchewan, which burned in 2025. Replace with your own fire: draw a
// rectangle with the geometry tool and set AOI = geometry;
var AOI = ee.Geometry.Rectangle([-103.0, 54.4, -101.85, 55.2]);

// Seasonal windows (same phenology before and after the fire)
var SEASON_START = '-07-01';
var SEASON_END   = '-09-15';

// Time-series range
var TS_START_YEAR = 2000;
var TS_END_YEAR   = FIRE_YEAR + 1;

// Subtract the median dNBR of unburned forest (phenology offset)?
var APPLY_DNBR_OFFSET = true;

// Scales (m). Coarser scales keep interactive charts fast.
var SCALE        = 30;
var CHART_SCALE  = 90;

// Export settings
var EXPORT_FOLDER = 'gee_burn_severity';
var EXPORT_CRS    = 'EPSG:3978';   // Canada Atlas Lambert

// ============================ LANDSAT HELPERS ================================

var BANDS = ['blue', 'green', 'red', 'nir', 'swir1', 'swir2'];

// QA_PIXEL bits: 1 dilated cloud, 3 cloud, 4 cloud shadow, 5 snow, 7 water
function qaMask(img) {
  var qa = img.select('QA_PIXEL');
  return qa.bitwiseAnd(1 << 1).eq(0)
    .and(qa.bitwiseAnd(1 << 3).eq(0))
    .and(qa.bitwiseAnd(1 << 4).eq(0))
    .and(qa.bitwiseAnd(1 << 5).eq(0))
    .and(qa.bitwiseAnd(1 << 7).eq(0));
}

// Landsat 8/9 OLI Collection 2 Level 2
function prepOLI(img) {
  var sr = img.select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'], BANDS)
    .multiply(0.0000275).add(-0.2);
  return ee.Image(sr.updateMask(qaMask(img))
    .copyProperties(img, ['system:time_start']));
}

// Landsat 5 TM / 7 ETM+ Collection 2 Level 2, harmonized to OLI
// (Roy et al. 2016, ETM+ -> OLI OLS coefficients)
var SLOPES = ee.Image.constant([0.8474, 0.8483, 0.9047, 0.8462, 0.8937, 0.9071]);
var ITCPS  = ee.Image.constant([0.0003, 0.0088, 0.0061, 0.0412, 0.0254, 0.0172]);

function prepTM(img) {
  var sr = img.select(['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7'], BANDS)
    .multiply(0.0000275).add(-0.2)
    .multiply(SLOPES).add(ITCPS)
    .rename(BANDS);
  return ee.Image(sr.updateMask(qaMask(img))
    .copyProperties(img, ['system:time_start']));
}

function landsat(start, end, region) {
  var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
    .filterBounds(region).filterDate(start, end).map(prepOLI);
  var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(region).filterDate(start, end).map(prepOLI);
  var l7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
    .filterBounds(region).filterDate(start, end).map(prepTM);
  var l5 = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
    .filterBounds(region).filterDate(start, end).map(prepTM);
  return l9.merge(l8).merge(l7).merge(l5);
}

function nbr(img) {
  return img.normalizedDifference(['nir', 'swir2']).rename('NBR');
}

// ============================ MASKS ==========================================

// Burned area from MODIS MCD64A1 (500 m) for the fire year
var modisBurn = ee.ImageCollection('MODIS/061/MCD64A1')
  .filterDate(FIRE_YEAR + '-01-01', (FIRE_YEAR + 1) + '-01-01')
  .select('BurnDate')
  .max()
  .gt(0)
  .unmask(0)
  .clip(AOI)
  .rename('burned');

// Pre-fire forest from ESA WorldCover 2021 (class 10 = tree cover)
// NOTE: for fires before 2021 this map is post-fire; use an older land cover.
var forest = ee.ImageCollection('ESA/WorldCover/v200').first()
  .eq(10).clip(AOI).rename('forest');

var burnedForest  = modisBurn.eq(1).and(forest);
var controlForest = modisBurn.eq(0).and(forest);

// ============================ PRE / POST COMPOSITES ==========================

var preCol  = landsat((FIRE_YEAR - 1) + SEASON_START, (FIRE_YEAR - 1) + SEASON_END, AOI);
var postCol = landsat((FIRE_YEAR + 1) + SEASON_START, (FIRE_YEAR + 1) + SEASON_END, AOI);

print('Pre-fire Landsat scenes', preCol.size());
print('Post-fire Landsat scenes', postCol.size());

var pre  = preCol.median().clip(AOI);
var post = postCol.median().clip(AOI);

var preNBR  = nbr(pre).rename('preNBR');
var postNBR = nbr(post).rename('postNBR');
var dNBRraw = preNBR.subtract(postNBR).rename('dNBR');

// Phenology offset: median dNBR of unburned forest should be ~0
var offset = ee.Number(dNBRraw.updateMask(controlForest).reduceRegion({
  reducer: ee.Reducer.median(),
  geometry: AOI,
  scale: CHART_SCALE,
  maxPixels: 1e13,
  tileScale: 4
}).get('dNBR'));
print('dNBR offset (median of unburned forest)', offset);

var dNBR = APPLY_DNBR_OFFSET ? dNBRraw.subtract(offset).rename('dNBR') : dNBRraw;

// Relative indices
var RdNBR = dNBR.divide(preNBR.abs().max(0.001).sqrt()).rename('RdNBR'); // Miller & Thode 2007
var RBR   = dNBR.divide(preNBR.add(1.001)).rename('RBR');                // Parks et al. 2014

// ============================ SEVERITY CLASSES ===============================
// USGS FIREMON thresholds (dNBR, unscaled)
var CLASS_NAMES = ee.List([
  'Enhanced regrowth, high', 'Enhanced regrowth, low', 'Unburned',
  'Low severity', 'Moderate-low severity', 'Moderate-high severity', 'High severity'
]);
var CLASS_PALETTE = ['7a8737', 'acbe4d', '0ae042', 'fff70b', 'ffaf38', 'ff641b', 'a41fd6'];

var severity = ee.Image(3)
  .where(dNBR.lt(-0.25), 1)
  .where(dNBR.gte(-0.25).and(dNBR.lt(-0.1)), 2)
  .where(dNBR.gte(0.1).and(dNBR.lt(0.27)), 4)
  .where(dNBR.gte(0.27).and(dNBR.lt(0.44)), 5)
  .where(dNBR.gte(0.44).and(dNBR.lt(0.66)), 6)
  .where(dNBR.gte(0.66), 7)
  .updateMask(dNBR.mask())
  .clip(AOI)
  .rename('severity');

// Area (ha) per class inside the burned perimeter
var areaStats = ee.Image.pixelArea().divide(10000)
  .addBands(severity)
  .updateMask(modisBurn.eq(1))
  .reduceRegion({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'class'}),
    geometry: AOI,
    scale: SCALE,
    maxPixels: 1e13,
    tileScale: 4
  });

var severityTable = ee.FeatureCollection(
  ee.List(areaStats.get('groups')).map(function (g) {
    g = ee.Dictionary(g);
    var c = ee.Number(g.get('class')).int();
    return ee.Feature(null, {
      class: c,
      name: CLASS_NAMES.get(c.subtract(1)),
      area_ha: ee.Number(g.get('sum')).round()
    });
  })
);

print('Burned area (ha, MODIS perimeter)',
  ee.Image.pixelArea().divide(10000).updateMask(modisBurn.eq(1)).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: AOI, scale: SCALE, maxPixels: 1e13, tileScale: 4
  }).get('area'));
print('Area by severity class (ha)', severityTable);

print(ui.Chart.feature.byFeature(severityTable, 'name', 'area_ha')
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Burned area by severity class, ' + FIRE_YEAR,
    legend: {position: 'none'},
    vAxis: {title: 'Area (ha)'},
    colors: ['ff641b']
  }));

print(ui.Chart.image.histogram({
  image: dNBR.updateMask(modisBurn.eq(1)),
  region: AOI,
  scale: CHART_SCALE,
  maxBuckets: 80,
  maxPixels: 1e9
}).setOptions({title: 'dNBR distribution inside burned area', legend: {position: 'none'}}));

// ============================ ANNUAL NBR TIME SERIES =========================

var years = ee.List.sequence(TS_START_YEAR, TS_END_YEAR);

var annual = ee.ImageCollection.fromImages(years.map(function (y) {
  y = ee.Number(y);
  var s = ee.Date.fromYMD(y, 7, 1);
  var e = ee.Date.fromYMD(y, 9, 15);
  var col = landsat(s, e, AOI);
  var img = ee.Image(ee.Algorithms.If(
    col.size().gt(0),
    nbr(col.median()),
    ee.Image.constant(0).rename('NBR').updateMask(0)
  ));
  return img.set({'system:time_start': s.millis(), year: y, n_scenes: col.size()});
}));

var timeSeries = ee.FeatureCollection(annual.map(function (img) {
  var burned = img.updateMask(burnedForest).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: AOI, scale: CHART_SCALE,
    maxPixels: 1e13, tileScale: 4
  }).get('NBR');
  var control = img.updateMask(controlForest).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: AOI, scale: CHART_SCALE,
    maxPixels: 1e13, tileScale: 4
  }).get('NBR');
  return ee.Feature(null, {
    year: img.get('year'),
    nbr_burned_forest: burned,
    nbr_unburned_forest: control,
    n_scenes: img.get('n_scenes')
  });
}));

print(ui.Chart.feature.byFeature(timeSeries, 'year', ['nbr_burned_forest', 'nbr_unburned_forest'])
  .setChartType('LineChart')
  .setOptions({
    title: 'Summer NBR: ' + FIRE_YEAR + ' burned forest vs unburned forest',
    hAxis: {title: 'Year', format: '####'},
    vAxis: {title: 'Mean NBR'},
    lineWidth: 2,
    pointSize: 3,
    colors: ['d7301f', '238b45']
  }));

// ============================ CANOPY HEIGHT (LiDAR-calibrated) ===============
// ETH Global Canopy Height 2020 (Lang et al. 2023): Sentinel-2 deep learning
// model trained on GEDI spaceborne LiDAR. Pre-fire structure for fires >= 2021.
var canopy = ee.Image('users/nlang/ETH_GlobalCanopyHeight_2020_10m_v1')
  .rename('canopy_h').clip(AOI);

// GEDI footprints only exist between 51.6 S and 51.6 N.
var aoiLat = ee.Number(AOI.centroid(1).coordinates().get(1));
print('AOI centroid latitude', aoiLat,
  'GEDI L2A footprints available here?', aoiLat.abs().lt(51.6));

// Optional direct GEDI rh98 (only useful south of 51.6 N)
var gedi = ee.ImageCollection('LARSE/GEDI/GEDI02_A_002_MONTHLY')
  .filterBounds(AOI)
  .filterDate('2019-04-01', FIRE_YEAR + '-01-01')
  .map(function (img) {
    return img.updateMask(img.select('quality_flag').eq(1))
              .updateMask(img.select('degrade_flag').eq(0))
              .select('rh98');
  })
  .median()
  .clip(AOI);

// Mean dNBR per 5 m canopy-height bin (burned forest only)
var hBin = canopy.divide(5).floor().multiply(5).rename('h_bin');

var binStats = dNBR.addBands(hBin)
  .updateMask(burnedForest)
  .reduceRegion({
    reducer: ee.Reducer.mean()
      .combine({reducer2: ee.Reducer.count(), sharedInputs: true})
      .group({groupField: 1, groupName: 'h_bin'}),
    geometry: AOI,
    scale: SCALE,
    maxPixels: 1e13,
    tileScale: 4
  });

var canopyTable = ee.FeatureCollection(
  ee.List(binStats.get('groups')).map(function (g) {
    g = ee.Dictionary(g);
    return ee.Feature(null, {
      canopy_bin_m: g.get('h_bin'),
      mean_dNBR: g.get('mean'),
      n_pixels: g.get('count')
    });
  })
).filter(ee.Filter.gte('n_pixels', 50));

print('Mean dNBR by pre-fire canopy height', canopyTable);
print(ui.Chart.feature.byFeature(canopyTable, 'canopy_bin_m', 'mean_dNBR')
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Burn severity vs pre-fire canopy height',
    hAxis: {title: 'Canopy height bin (m, lower edge)'},
    vAxis: {title: 'Mean dNBR'},
    legend: {position: 'none'},
    colors: ['a41fd6']
  }));

// Pixel sample: scatter + Pearson correlation
var sample = dNBR.addBands(canopy).addBands(RBR)
  .updateMask(burnedForest)
  .sample({region: AOI, scale: SCALE, numPixels: 5000, seed: 42, geometries: false, tileScale: 4});

print('Pearson r (canopy height vs dNBR)',
  sample.reduceColumns(ee.Reducer.pearsonsCorrelation(), ['canopy_h', 'dNBR']));

print(ui.Chart.feature.byFeature(sample.limit(2000), 'canopy_h', 'dNBR')
  .setChartType('ScatterChart')
  .setOptions({
    title: 'Pixel sample: canopy height vs dNBR',
    hAxis: {title: 'Canopy height (m)'},
    vAxis: {title: 'dNBR'},
    pointSize: 1,
    legend: {position: 'none'}
  }));

// ============================ MAP ============================================

Map.centerObject(AOI, 9);
var fc = {bands: ['swir2', 'nir', 'red'], min: 0, max: 0.4};
Map.addLayer(pre, fc, 'Pre-fire (SWIR2-NIR-Red)', false);
Map.addLayer(post, fc, 'Post-fire (SWIR2-NIR-Red)');
Map.addLayer(dNBR, {min: -0.3, max: 0.9, palette: ['1a9850', 'ffffbf', 'd73027', '67001f']}, 'dNBR', false);
Map.addLayer(severity, {min: 1, max: 7, palette: CLASS_PALETTE}, 'Burn severity (FIREMON)');
Map.addLayer(modisBurn.selfMask(), {palette: ['000000']}, 'MODIS burned perimeter', false, 0.4);
Map.addLayer(canopy, {min: 0, max: 30, palette: ['f7fcb9', '78c679', '006837']}, 'Canopy height 2020 (m)', false);
Map.addLayer(gedi, {min: 0, max: 30, palette: ['f7fcb9', '78c679', '006837']}, 'GEDI rh98 (if available)', false);
Map.addLayer(ee.Image().paint(AOI, 0, 2), {palette: ['00ffff']}, 'AOI');

// Legend
var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 12px'}});
legend.add(ui.Label('Burn severity (dNBR)', {fontWeight: 'bold'}));
CLASS_NAMES.evaluate(function (names) {
  names.forEach(function (n, i) {
    legend.add(ui.Panel([
      ui.Label('', {backgroundColor: '#' + CLASS_PALETTE[i], padding: '8px', margin: '2px 6px 2px 0'}),
      ui.Label(n, {margin: '2px 0'})
    ], ui.Panel.Layout.Flow('horizontal')));
  });
});
Map.add(legend);

// ============================ EXPORTS ========================================

Export.image.toDrive({
  image: dNBR.addBands(RdNBR).addBands(RBR).addBands(severity.toFloat())
    .addBands(preNBR).addBands(postNBR).toFloat(),
  description: 'burn_severity_' + FIRE_YEAR,
  folder: EXPORT_FOLDER,
  region: AOI,
  scale: SCALE,
  crs: EXPORT_CRS,
  maxPixels: 1e13
});

Export.table.toDrive({
  collection: severityTable,
  description: 'severity_area_' + FIRE_YEAR,
  folder: EXPORT_FOLDER,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: timeSeries,
  description: 'nbr_timeseries_' + FIRE_YEAR,
  folder: EXPORT_FOLDER,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: canopyTable,
  description: 'dnbr_by_canopy_height_' + FIRE_YEAR,
  folder: EXPORT_FOLDER,
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: sample,
  description: 'pixel_sample_' + FIRE_YEAR,
  folder: EXPORT_FOLDER,
  fileFormat: 'CSV'
});
