# Wildfire Burn Severity & Forest Structure — Saskatchewan (Google Earth Engine)

Maps burn severity for a boreal wildfire from Landsat, tracks forest recovery with a 2000–present NBR time series, and tests whether pre-fire canopy height (LiDAR-calibrated) relates to how severely the forest burned.

## Research question
Do taller, more structurally developed boreal stands burn more severely, and how fast does their spectral signal recover compared with unburned forest?

## Data (all in the Earth Engine catalog)
| Purpose | Dataset |
| --- | --- |
| Optical time series | Landsat 5, 7, 8, 9 Collection 2 Level 2 surface reflectance |
| Burned-area perimeter | MODIS MCD64A1 v6.1 (500 m) |
| Forest mask | ESA WorldCover 2021 v200 (tree cover) |
| Pre-fire canopy height | ETH Global Canopy Height 2020, 10 m (Lang et al. 2023), trained on GEDI LiDAR |
| Direct LiDAR (optional) | GEDI L2A monthly rh98 (only south of 51.6° N) |

## Method
1. Cloud, shadow, snow and water masking with `QA_PIXEL`; TM/ETM+ harmonized to OLI (Roy et al. 2016).
2. July–mid-September median composites for the summer before and after the fire.
3. NBR, dNBR (offset by the median dNBR of unburned forest), RdNBR (Miller & Thode 2007) and RBR (Parks et al. 2014).
4. Severity classes using USGS FIREMON thresholds (Key & Benson 2006); area per class in hectares.
5. Annual summer NBR, 2000 to the year after the fire, for burned vs unburned forest.
6. Mean dNBR by 5 m canopy-height bin, a 5,000-pixel sample, and Pearson's r.

## How to run
1. Sign up at [code.earthengine.google.com](https://code.earthengine.google.com) with a Google account (free for research and education).
2. Paste `burn_severity_lidar.js` into a new script and click **Run**.
3. To analyse a different fire, change `FIRE_YEAR` and draw a rectangle around it (then set `AOI = geometry;`). Fire perimeters and dates: Canadian Wildland Fire Information System (CWFIS) or the National Burned Area Composite (NBAC).
4. Charts appear in the **Console**; layers on the map. Start the exports from the **Tasks** tab; files go to the `gee_burn_severity` folder in Google Drive.

## Outputs
- `burn_severity_<year>.tif` — dNBR, RdNBR, RBR, severity class, pre/post NBR (30 m, EPSG:3978)
- `severity_area_<year>.csv` — hectares per severity class
- `nbr_timeseries_<year>.csv` — annual NBR, burned vs unburned forest
- `dnbr_by_canopy_height_<year>.csv` — mean dNBR per canopy-height bin
- `pixel_sample_<year>.csv` — sampled dNBR, RBR and canopy height

## Limitations
- GEDI has no footprints north of 51.6° N, so most Saskatchewan fires rely on the GEDI-trained canopy height model rather than direct LiDAR. ICESat-2 ATL08 canopy heights cover these latitudes but must be downloaded from NASA Earthdata.
- The MODIS perimeter is 500 m and misses small fires and unburned islands; NBAC perimeters are more accurate.
- Landsat 7 has scan-line gaps after 2003; median compositing reduces but does not remove them.
- dNBR thresholds were developed for US forests; field data (Composite Burn Index plots) are needed to calibrate them for Saskatchewan boreal forest.
- For fires before 2021, WorldCover and the 2020 canopy model describe post-fire conditions; use an older land-cover map.

## Next steps
- Use LandTrendr or CCDC for pixel-level disturbance and recovery trajectories.
- Add ICESat-2 ATL08 for direct canopy-height measurements north of 51.6° N.
- Train a model (e.g., random forest or gradient boosting with SHAP) to predict severity from structure, topography and fire weather.

## References
- Key, C.H. & Benson, N.C. (2006). Landscape Assessment (LA): Sampling and analysis methods. USDA Forest Service, RMRS-GTR-164-CD.
- Miller, J.D. & Thode, A.E. (2007). Quantifying burn severity in a heterogeneous landscape with a relative version of the delta Normalized Burn Ratio (dNBR). *Remote Sensing of Environment*, 109, 66–80.
- Parks, S.A., Dillon, G.K. & Miller, C. (2014). A new metric for quantifying burn severity: the Relativized Burn Ratio. *Remote Sensing*, 6, 1827–1844.
- Roy, D.P. et al. (2016). Characterization of Landsat-7 to Landsat-8 reflective wavelength and normalized difference vegetation index continuity. *Remote Sensing of Environment*, 185, 57–70.
- Lang, N. et al. (2023). A high-resolution canopy height model of the Earth. *Nature Ecology & Evolution*, 7, 1778–1789.

Author: Uday Karmoker
